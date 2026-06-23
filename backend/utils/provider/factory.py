from .exceptions import NotSupportedError
from .gitlab import GitLabProvider
from .gitea import GiteaProvider
from .svn import SVNProvider
from .jenkins import JenkinsProvider


PROVIDER_MAP = {
    "gitlab": GitLabProvider,
    "gitea": GiteaProvider,
    "svn": SVNProvider,
    "jenkins": JenkinsProvider,
}


def get_provider(vendor: str, server_url: str, credential_data: dict):
    """根据 vendor 返回对应的 Provider 实例"""
    provider_cls = PROVIDER_MAP.get(vendor)
    if not provider_cls:
        raise NotSupportedError(f"不支持的 vendor: {vendor}")
    return provider_cls(server_url, credential_data)
