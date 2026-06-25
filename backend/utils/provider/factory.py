"""
Provider 工厂

根据 vendor 名称创建对应的 Provider 实例。
"""
from .exceptions import NotSupportedError
from .gitlab import GitLabProvider
from .gitea import GiteaProvider
from .svn import SVNProvider
from .jenkins import JenkinsProvider


# vendor 到 Provider 类的映射
PROVIDER_MAP = {
    "gitlab": GitLabProvider,
    "gitea": GiteaProvider,
    "svn": SVNProvider,
    "jenkins": JenkinsProvider,
}


def get_provider(vendor: str, server_url: str, credential_data: dict):
    """
    根据 vendor 返回对应的 Provider 实例

    Args:
        vendor: 平台名称，如 gitlab/svn/jenkins
        server_url: 服务器地址
        credential_data: 解密后的凭证数据

    Returns:
        Provider 实例

    Raises:
        NotSupportedError: 不支持的 vendor 时抛出
    """
    provider_cls = PROVIDER_MAP.get(vendor)
    if not provider_cls:
        raise NotSupportedError(f"不支持的 vendor: {vendor}")
    return provider_cls(server_url, credential_data)
