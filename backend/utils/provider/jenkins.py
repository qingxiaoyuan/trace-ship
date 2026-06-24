"""
Jenkins Provider

阶段二仅实现基础 HTTP 连通性探测。
"""
import requests

from .exceptions import ConnectionError as ProviderConnectionError


class JenkinsProvider:
    """
    Jenkins 简单连通性测试适配器

    阶段二仅做基础 HTTP 探测，不校验 Job 权限。
    """

    def __init__(self, server_url: str, credential_data: dict):
        """
        Args:
            server_url: Jenkins 服务器地址
            credential_data: 解密后的凭证数据
        """
        self.server_url = server_url.rstrip("/")
        self.credential_data = credential_data

    def test_connection(self) -> bool:
        """
        测试 Jenkins 地址可达性

        Returns:
            HTTP 状态码小于 500 视为可达

        Raises:
            ProviderConnectionError: 请求失败时抛出
        """
        try:
            # 阶段二仅验证 Jenkins 地址可达，不校验 Job 权限
            resp = requests.get(self.server_url, timeout=10)
            return resp.status_code < 500
        except requests.RequestException as exc:
            raise ProviderConnectionError(f"Jenkins 连接失败: {exc}") from exc
