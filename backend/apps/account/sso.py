"""
EKP OA 单点登录（token 验票）配置与验票辅助

配置来源优先级：「系统配置」页面（sys_config 表，sso_* 键）> 环境变量。
SSO 登录时动态读取配置，无需重启服务。

支持的配置项（sys_config 键 / 环境变量）：

- sso_enabled / -：是否启用 OA 单点登录（仅页面配置，环境变量配置即视为启用）
- sso_verify_url / SSO_VERIFY_URL：OA 中间件验票接口完整地址（按系统注册入口分配）

验票接口契约（OA 中间件提供）：

- 请求：POST {sso_verify_url}，Body {"token": "sso_xxx"}
- 成功：{"code":0,"data":{"result":100,"userDetail":{"userId":...,"userName":...,"email":...,"department":...}}}
- 失败：code=-1，data.result=101(token不存在或已使用) / 102(token已过期)
"""
import logging
import os
from typing import Any

import requests

logger = logging.getLogger(__name__)

CONFIG_KEY_ENABLED = "sso_enabled"
CONFIG_KEY_VERIFY_URL = "sso_verify_url"

SSO_CONFIG_KEYS = [
    CONFIG_KEY_ENABLED,
    CONFIG_KEY_VERIFY_URL,
]

# 验票请求超时时间（秒）
VERIFY_TIMEOUT = 5

# 验票成功结果码
VERIFY_RESULT_SUCCESS = 100


class SsoVerifyError(RuntimeError):
    """SSO 验票失败（token 无效/已使用/过期或验票服务不可用）。"""


def resolve_sso_config() -> dict[str, Any]:
    """
    解析当前生效的 SSO 配置

    「系统配置」页面维护的 sso_* 键优先，未配置的回退环境变量；
    页面显式设置 sso_enabled=false 时即使配置了环境变量也视为停用。

    Returns:
        配置字典：enabled/verify_url
    """
    from apps.system.services import SystemConfigService

    stored = SystemConfigService.get_many(SSO_CONFIG_KEYS)

    def pick(key: str, env_name: str) -> str:
        return (stored.get(key) or os.getenv(env_name, "") or "").strip()

    verify_url = pick(CONFIG_KEY_VERIFY_URL, "SSO_VERIFY_URL")

    enabled_raw = stored.get(CONFIG_KEY_ENABLED)
    if enabled_raw is not None:
        enabled = enabled_raw.strip().lower() in ("1", "true", "yes", "on")
    else:
        # 页面未配置开关时：验票地址非空即视为启用（与 LDAP 语义一致）
        enabled = bool(verify_url)

    return {
        "enabled": enabled,
        "verify_url": verify_url,
    }


def verify_sso_token(token: str) -> dict[str, Any]:
    """
    调用 OA 中间件验票接口验证 SSO token

    Args:
        token: OA 重定向携带的一次性 SSO token

    Returns:
        用户身份字典：userId/userName/email/department

    Raises:
        SsoVerifyError: token 无效/已使用/过期，或验票服务不可用
    """
    cfg = resolve_sso_config()
    if not cfg["enabled"] or not cfg["verify_url"]:
        raise SsoVerifyError("SSO 单点登录未启用")

    try:
        # 不跟随重定向：验票地址被误配成 302 时避免一次性 token 泄露给重定向目标
        resp = requests.post(
            cfg["verify_url"], json={"token": token}, timeout=VERIFY_TIMEOUT, allow_redirects=False
        )
        payload = resp.json()
    except requests.RequestException as exc:
        logger.warning("SSO 验票请求失败：%s", exc)
        raise SsoVerifyError("SSO 验票服务不可用，请稍后重试") from exc
    except ValueError as exc:
        logger.warning("SSO 验票返回非 JSON：%s", exc)
        raise SsoVerifyError("SSO 验票服务返回异常") from exc

    data = payload.get("data") or {}
    if payload.get("code") == 0 and data.get("result") == VERIFY_RESULT_SUCCESS:
        user_detail = data.get("userDetail") or {}
        if not user_detail.get("userId"):
            raise SsoVerifyError("SSO 验票成功但未返回用户标识")
        return user_detail

    # 101 token不存在或已使用 / 102 token已过期：错误信息直接透传给前端展示
    message = data.get("message") or payload.get("msg") or "token 验证失败"
    raise SsoVerifyError(message)
