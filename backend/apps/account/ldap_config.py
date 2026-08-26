"""
LDAP 连接配置与认证辅助

配置来源优先级：「系统配置」页面（sys_config 表，ldap_* 键）> 环境变量。
登录时动态读取配置并应用（含 ldaps 证书校验策略与 CA 证书），无需重启服务。

支持的配置项（sys_config 键 / 环境变量）：

- ldap_enabled / -：是否在页面启用 LDAP（仅页面配置，环境变量配置即视为启用）
- ldap_server_uri / LDAP_SERVER_URI：服务地址，如 ldap://host:389 或 ldaps://host:636
- ldap_bind_dn / LDAP_BIND_DN：用于搜索用户的服务账号 DN（可空，匿名搜索）
- ldap_bind_password / LDAP_BIND_PASSWORD：服务账号密码
- ldap_user_search_base / LDAP_USER_SEARCH_BASE：用户搜索基准 DN
- ldap_user_filter / LDAP_USER_FILTER：登录过滤器，默认 (uid=%(user)s)，AD 可用 (sAMAccountName=%(user)s)
- ldap_tls_reqcert / LDAP_TLS_REQCERT：证书校验策略 demand/allow/never（默认 demand）
- ldap_ca_cert / LDAP_CA_CERT_PATH：CA 证书——页面存 PEM 内容，环境变量存服务器文件路径
"""
import hashlib
import logging
import os
import re
from pathlib import Path
from typing import Any

from django.conf import settings

logger = logging.getLogger(__name__)

# 域账号显示名中的部门前缀，如 <研发部>张三
DEPARTMENT_PREFIX_RE = re.compile(r"^<([^<>]+)>\s*(.*)$")


def parse_ldap_display_name(raw: str) -> tuple[str, str]:
    """
    解析 LDAP 返回的显示名，拆分部门与姓名

    形如 <研发部>张三 的显示名拆为 (研发部, 张三)；
    无部门前缀时返回 ("", 原始显示名)。

    Returns:
        (部门, 姓名) 二元组
    """
    raw = (raw or "").strip()
    match = DEPARTMENT_PREFIX_RE.match(raw)
    if match and match.group(2).strip():
        return match.group(1).strip(), match.group(2).strip()
    return "", raw

CONFIG_KEY_ENABLED = "ldap_enabled"
CONFIG_KEY_SERVER_URI = "ldap_server_uri"
CONFIG_KEY_BIND_DN = "ldap_bind_dn"
CONFIG_KEY_BIND_PASSWORD = "ldap_bind_password"
CONFIG_KEY_SEARCH_BASE = "ldap_user_search_base"
CONFIG_KEY_USER_FILTER = "ldap_user_filter"
CONFIG_KEY_TLS_REQCERT = "ldap_tls_reqcert"
CONFIG_KEY_CA_CERT = "ldap_ca_cert"

LDAP_CONFIG_KEYS = [
    CONFIG_KEY_ENABLED,
    CONFIG_KEY_SERVER_URI,
    CONFIG_KEY_BIND_DN,
    CONFIG_KEY_BIND_PASSWORD,
    CONFIG_KEY_SEARCH_BASE,
    CONFIG_KEY_USER_FILTER,
    CONFIG_KEY_TLS_REQCERT,
    CONFIG_KEY_CA_CERT,
]

DEFAULT_USER_FILTER = "(uid=%(user)s)"

# 证书校验策略映射（值为 python-ldap 的 OPT_X_TLS_* 常量名，延迟解析避免顶层依赖 python-ldap）
TLS_REQCERT_OPTIONS = {
    "demand": "OPT_X_TLS_DEMAND",
    "allow": "OPT_X_TLS_ALLOW",
    "never": "OPT_X_TLS_NEVER",
    "try": "OPT_X_TLS_TRY",
}


class LdapConfigError(RuntimeError):
    """LDAP 配置缺失或连接异常。"""


def resolve_ldap_config() -> dict[str, Any]:
    """
    解析当前生效的 LDAP 配置

    「系统配置」页面维护的 ldap_* 键优先，未配置的回退环境变量；
    页面显式设置 ldap_enabled=false 时即使配置了环境变量也视为停用。

    Returns:
        配置字典：enabled/server_uri/bind_dn/bind_password/user_search_base/
        user_filter/tls_reqcert/ca_cert/ca_cert_path
    """
    from apps.system.services import SystemConfigService

    stored = SystemConfigService.get_many(LDAP_CONFIG_KEYS)

    def pick(key: str, env_name: str) -> str:
        return (stored.get(key) or os.getenv(env_name, "") or "").strip()

    server_uri = pick(CONFIG_KEY_SERVER_URI, "LDAP_SERVER_URI")
    search_base = pick(CONFIG_KEY_SEARCH_BASE, "LDAP_USER_SEARCH_BASE")

    enabled_raw = stored.get(CONFIG_KEY_ENABLED)
    if enabled_raw is not None:
        enabled = enabled_raw.strip().lower() in ("1", "true", "yes", "on")
    else:
        # 页面未配置开关时：环境变量配置完整即视为启用（保持原有行为）
        enabled = bool(server_uri and search_base)

    return {
        "enabled": enabled,
        "server_uri": server_uri,
        "bind_dn": pick(CONFIG_KEY_BIND_DN, "LDAP_BIND_DN"),
        "bind_password": pick(CONFIG_KEY_BIND_PASSWORD, "LDAP_BIND_PASSWORD"),
        "user_search_base": search_base,
        "user_filter": pick(CONFIG_KEY_USER_FILTER, "LDAP_USER_FILTER") or DEFAULT_USER_FILTER,
        "tls_reqcert": (pick(CONFIG_KEY_TLS_REQCERT, "LDAP_TLS_REQCERT") or "demand").lower(),
        "ca_cert": stored.get(CONFIG_KEY_CA_CERT, "") or "",
        "ca_cert_path": os.getenv("LDAP_CA_CERT_PATH", "") or "",
    }


def _ensure_ca_cert_file(pem: str) -> str:
    """
    将页面维护的 CA 证书 PEM 内容写入运行时目录并返回文件路径

    内容不变时不重复写入；文件权限 0600。
    """
    runtime_dir = Path(settings.BASE_DIR) / ".runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    ca_path = runtime_dir / "ldap-ca.pem"
    digest = hashlib.sha256(pem.encode("utf-8")).hexdigest()
    marker = runtime_dir / "ldap-ca.sha256"
    if ca_path.exists() and marker.exists() and marker.read_text().strip() == digest:
        return str(ca_path)
    ca_path.write_text(pem)
    os.chmod(ca_path, 0o600)
    marker.write_text(digest)
    return str(ca_path)


def _apply_tls_options(ldap_module: Any, cfg: dict[str, Any]) -> None:
    """应用 ldaps 证书校验策略与 CA 证书（全局生效，需在建立连接前调用）"""
    reqcert = cfg.get("tls_reqcert") or "demand"
    const_name = TLS_REQCERT_OPTIONS.get(reqcert)
    if const_name:
        ldap_module.set_option(ldap_module.OPT_X_TLS_REQUIRE_CERT, getattr(ldap_module, const_name))
    ca_path = cfg.get("ca_cert_path") or ""
    if not ca_path and (cfg.get("ca_cert") or "").strip():
        ca_path = _ensure_ca_cert_file(cfg["ca_cert"])
    if ca_path:
        ldap_module.set_option(ldap_module.OPT_X_TLS_CACERTFILE, ca_path)


def _load_ldap_module() -> Any:
    """
    延迟加载 python-ldap

    未安装（如本地开发环境）时抛出 LdapConfigError，由调用方决定是否降级。
    """
    try:
        import ldap
    except ImportError as exc:
        raise LdapConfigError("当前环境未安装 python-ldap，无法使用 LDAP 认证") from exc
    return ldap


def _load_ldap_modules() -> tuple[Any, Any, Any]:
    """延迟加载 python-ldap 与 django-auth-ldap（登录认证路径使用）"""
    ldap = _load_ldap_module()
    try:
        from django_auth_ldap.backend import LDAPBackend
        from django_auth_ldap.config import LDAPSearch
    except ImportError as exc:
        raise LdapConfigError("当前环境未安装 django-auth-ldap，无法使用 LDAP 认证") from exc
    return ldap, LDAPBackend, LDAPSearch


def authenticate_ldap(request: Any, username: str, password: str) -> Any | None:
    """
    使用当前生效的 LDAP 配置尝试认证用户

    配置未启用、不完整或连接失败时返回 None（由调用方回退本地认证）。

    Returns:
        认证成功返回 Django User，否则返回 None
    """
    cfg = resolve_ldap_config()
    if not cfg["enabled"] or not cfg["server_uri"] or not cfg["user_search_base"]:
        return None
    try:
        ldap, LDAPBackend, LDAPSearch = _load_ldap_modules()
    except LdapConfigError as exc:
        logger.warning("LDAP 认证不可用：%s", exc)
        return None

    _apply_tls_options(ldap, cfg)

    # django-auth-ldap 在 authenticate 时读取 settings，动态覆盖为当前生效配置
    settings.AUTH_LDAP_SERVER_URI = cfg["server_uri"]
    settings.AUTH_LDAP_BIND_DN = cfg["bind_dn"]
    settings.AUTH_LDAP_BIND_PASSWORD = cfg["bind_password"]
    settings.AUTH_LDAP_USER_SEARCH = LDAPSearch(
        cfg["user_search_base"],
        ldap.SCOPE_SUBTREE,
        cfg["user_filter"],
    )
    settings.AUTH_LDAP_USER_ATTR_MAP = {"first_name": "cn", "email": "mail"}
    settings.AUTH_LDAP_ALWAYS_UPDATE_USER = True

    try:
        backend = LDAPBackend()
        return backend.authenticate(request, username=username, password=password)
    except Exception as exc:
        logger.warning("LDAP 认证失败：%s", exc)
        return None


def search_ldap_user(username: str) -> dict[str, str] | None:
    """
    按登录过滤器搜索 LDAP 用户属性（用于 SSO 登录回填用户资料）

    使用服务账号绑定（未配置则匿名），返回 cn/mail 属性；
    LDAP 未启用、连接失败或查不到用户时返回 None，由调用方降级处理。

    Args:
        username: 登录账号（与 ldap_user_filter 匹配的 uid）

    Returns:
        {"cn": ..., "mail": ...} 属性字典，查不到返回 None
    """
    cfg = resolve_ldap_config()
    if not cfg["enabled"] or not cfg["server_uri"] or not cfg["user_search_base"]:
        return None
    try:
        ldap = _load_ldap_module()
        from ldap.filter import escape_filter_chars
    except (LdapConfigError, ImportError) as exc:
        logger.warning("LDAP 用户查询不可用：%s", exc)
        return None

    _apply_tls_options(ldap, cfg)

    try:
        conn = ldap.initialize(cfg["server_uri"])
        conn.set_option(ldap.OPT_NETWORK_TIMEOUT, 5)
        conn.set_option(ldap.OPT_TIMEOUT, 5)
        conn.protocol_version = 3
        conn.simple_bind_s(cfg["bind_dn"], cfg["bind_password"])
        # username 来自 OA 验票响应（半可信输入），格式化进过滤器前需转义
        results = conn.search_s(
            cfg["user_search_base"],
            ldap.SCOPE_SUBTREE,
            cfg["user_filter"] % {"user": escape_filter_chars(username)},
            ["cn", "mail"],
        )
        conn.unbind_s()
    except Exception as exc:
        logger.warning("LDAP 用户查询失败（username=%s）：%s", username, exc)
        return None

    for _dn, attrs in results:
        if not attrs:
            continue
        cn_values = attrs.get("cn") or []
        mail_values = attrs.get("mail") or []
        return {
            "cn": cn_values[0].decode("utf-8", errors="ignore") if cn_values else "",
            "mail": mail_values[0].decode("utf-8", errors="ignore") if mail_values else "",
        }
    return None


def test_ldap_connection() -> str:
    """
    使用当前生效的配置测试 LDAP 连通性

    依次验证：服务可达 -> 服务账号绑定（如配置）-> 搜索基准 DN 可访问。

    Returns:
        成功提示信息

    Raises:
        LdapConfigError: 配置缺失或任一步骤失败
    """
    cfg = resolve_ldap_config()
    if not cfg["server_uri"]:
        raise LdapConfigError("未配置 LDAP 服务地址")
    if not cfg["user_search_base"]:
        raise LdapConfigError("未配置用户搜索基准 DN")

    ldap = _load_ldap_module()
    _apply_tls_options(ldap, cfg)

    try:
        conn = ldap.initialize(cfg["server_uri"])
        conn.set_option(ldap.OPT_NETWORK_TIMEOUT, 5)
        conn.set_option(ldap.OPT_TIMEOUT, 5)
        conn.protocol_version = 3
        # 配置了服务账号则验证绑定，否则匿名绑定验证服务可达
        conn.simple_bind_s(cfg["bind_dn"], cfg["bind_password"])
        # BASE 范围搜索仅验证基准 DN 存在，避免 SUBTREE 触发服务端 size limit
        results = conn.search_s(
            cfg["user_search_base"],
            ldap.SCOPE_BASE,
            "(objectClass=*)",
            ["dn"],
        )
        conn.unbind_s()
    except ldap.INVALID_CREDENTIALS as exc:
        raise LdapConfigError("服务账号 DN 或密码错误，无法绑定 LDAP") from exc
    except ldap.NO_SUCH_OBJECT as exc:
        raise LdapConfigError("用户搜索基准 DN 不存在，请检查 ldap_user_search_base") from exc
    except ldap.LDAPError as exc:
        raise LdapConfigError(f"连接 LDAP 失败：{exc}") from exc
    except Exception as exc:
        raise LdapConfigError(f"LDAP 测试连接异常：{exc}") from exc

    if not results:
        raise LdapConfigError("连接成功，但搜索基准 DN 下未找到任何条目")
    return "连接成功，服务账号绑定与搜索基准 DN 均可用"


# 避免被 pytest 当作测试用例收集（函数名以 test_ 开头）
test_ldap_connection.__test__ = False
