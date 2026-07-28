"""
Nexus 仓库浏览服务

通过 Nexus Repository Manager 3.x 的 REST API（/service/rest/v1）浏览
docker 类型仓库及其中的镜像，供打包镜像配置选择镜像地址使用。

连接配置优先取自「系统配置」页面（sys_config 表，nexus_* 键），
为空时回退到 Django settings 环境变量：
- nexus_base_url / NEXUS_BASE_URL：Nexus 服务地址，如 http://nexus.example.com:8081
- nexus_username / NEXUS_USERNAME、nexus_password / NEXUS_PASSWORD：可选的 Basic 认证账号
- NEXUS_TIMEOUT：请求超时秒数（仅环境变量）
- nexus_registry_host / NEXUS_REGISTRY_HOST：镜像拉取地址（host:port，docker connector 端口），
  为空时从服务地址提取
"""
from typing import Any
from urllib.parse import urlparse

import requests
from django.conf import settings

# 系统配置页面（sys_config）中的 Nexus 配置键
CONFIG_KEY_BASE_URL = "nexus_base_url"
CONFIG_KEY_USERNAME = "nexus_username"
CONFIG_KEY_PASSWORD = "nexus_password"
CONFIG_KEY_REGISTRY_HOST = "nexus_registry_host"
NEXUS_CONFIG_KEYS = [
    CONFIG_KEY_BASE_URL,
    CONFIG_KEY_USERNAME,
    CONFIG_KEY_PASSWORD,
    CONFIG_KEY_REGISTRY_HOST,
]


class NexusError(RuntimeError):
    """Nexus 连接或响应异常。"""


class NexusService:
    """Nexus 3.x 仓库浏览服务。"""

    @classmethod
    def _config(cls) -> dict[str, str]:
        """读取 Nexus 连接配置：系统配置页面优先，环境变量兜底。"""
        from apps.system.services import SystemConfigService

        stored = SystemConfigService.get_many(NEXUS_CONFIG_KEYS)
        return {
            "base_url": stored.get(CONFIG_KEY_BASE_URL) or getattr(settings, "NEXUS_BASE_URL", "") or "",
            "username": stored.get(CONFIG_KEY_USERNAME) or getattr(settings, "NEXUS_USERNAME", "") or "",
            "password": stored.get(CONFIG_KEY_PASSWORD) or getattr(settings, "NEXUS_PASSWORD", "") or "",
            "registry_host": stored.get(CONFIG_KEY_REGISTRY_HOST) or getattr(settings, "NEXUS_REGISTRY_HOST", "") or "",
            "timeout": int(getattr(settings, "NEXUS_TIMEOUT", 10) or 10),
        }

    @classmethod
    def _base_url(cls, cfg: dict[str, str]) -> str:
        base_url = (cfg["base_url"] or "").rstrip("/")
        if not base_url:
            raise NexusError("未配置 Nexus 服务地址，请在「系统配置」页面维护 nexus_base_url")
        # 允许只填 host:port，缺协议时按 http 处理
        if not base_url.startswith(("http://", "https://")):
            base_url = f"http://{base_url}"
        return base_url

    @classmethod
    def _auth(cls, cfg: dict[str, str]) -> tuple[str, str] | None:
        return (cfg["username"], cfg["password"]) if cfg["username"] else None

    @classmethod
    def _request(cls, path: str, params: dict[str, Any] | None = None, cfg: dict[str, str] | None = None) -> Any:
        """发起 Nexus REST 请求并解析 JSON 响应。"""
        cfg = cfg or cls._config()
        url = f"{cls._base_url(cfg)}{path}"
        try:
            resp = requests.get(
                url,
                params={k: v for k, v in (params or {}).items() if v not in (None, "")},
                auth=cls._auth(cfg),
                timeout=cfg["timeout"],
            )
        except requests.RequestException as exc:
            raise NexusError(f"无法连接 Nexus：{exc}") from exc
        if resp.status_code == 401:
            raise NexusError("Nexus 认证失败，请检查「系统配置」中的 nexus_username / nexus_password")
        if resp.status_code >= 400:
            raise NexusError(f"Nexus 请求失败（HTTP {resp.status_code}）")
        try:
            return resp.json()
        except ValueError as exc:
            raise NexusError("Nexus 响应格式异常") from exc

    @classmethod
    def registry_host(cls, cfg: dict[str, str] | None = None) -> str:
        """镜像拉取地址的 host:port 部分，优先取 nexus_registry_host 配置。"""
        cfg = cfg or cls._config()
        registry = (cfg["registry_host"] or "").strip()
        if registry:
            return registry.removeprefix("http://").removeprefix("https://").rstrip("/")
        parsed = urlparse(cls._base_url(cfg))
        return parsed.netloc or parsed.path

    @classmethod
    def list_docker_repositories(cls) -> list[dict[str, str]]:
        """列出 Nexus 中 docker 格式的仓库。"""
        data = cls._request("/service/rest/v1/repositories")
        if not isinstance(data, list):
            raise NexusError("Nexus 仓库列表响应格式异常")
        return [
            {
                "name": item.get("name", ""),
                "format": item.get("format", ""),
                "type": item.get("type", ""),
            }
            for item in data
            if item.get("format") == "docker" and item.get("name")
        ]

    @classmethod
    def search_docker_images(
        cls,
        repository: str = "",
        keyword: str = "",
        continuation_token: str = "",
    ) -> dict[str, Any]:
        """
        搜索 docker 镜像，返回镜像列表和分页 token。

        返回结构：{"items": [{name, version, repository, image}], "continuation_token": str}
        image 字段为按 {host}/{repository}/{name}:{version} 拼接的镜像地址。
        """
        params: dict[str, Any] = {
            "format": "docker",
            "repository": repository,
            "name": keyword,
            "continuationToken": continuation_token,
        }
        cfg = cls._config()
        data = cls._request("/service/rest/v1/search", params, cfg)
        if not isinstance(data, dict):
            raise NexusError("Nexus 镜像搜索响应格式异常")
        host = cls.registry_host(cfg)
        items = []
        for item in data.get("items") or []:
            name = item.get("name", "")
            version = item.get("version", "")
            repo = item.get("repository", "")
            if not name or not version:
                continue
            items.append(
                {
                    "name": name,
                    "version": version,
                    "repository": repo,
                    "image": f"{host}/{repo}/{name}:{version}" if repo else f"{host}/{name}:{version}",
                }
            )
        return {
            "items": items,
            "continuation_token": data.get("continuationToken") or "",
        }
