import requests

from .exceptions import ConnectionError as ProviderConnectionError


class JenkinsProvider:
    """Jenkins 简单连通性测试适配器（阶段二仅做基础 HTTP 探测）"""

    def __init__(self, server_url: str, credential_data: dict):
        self.server_url = server_url.rstrip("/")
        self.credential_data = credential_data

    def test_connection(self) -> bool:
        try:
            # 阶段二仅验证 Jenkins 地址可达，不校验 Job 权限
            resp = requests.get(self.server_url, timeout=10)
            return resp.status_code < 500
        except requests.RequestException as exc:
            raise ProviderConnectionError(f"Jenkins 连接失败: {exc}") from exc
