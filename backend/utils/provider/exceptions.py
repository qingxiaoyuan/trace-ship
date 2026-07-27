"""
Provider 异常类

定义 Provider 相关异常的继承体系。
"""


class ProviderError(Exception):
    """Provider 通用异常"""
    pass


class AuthenticationError(ProviderError):
    """认证失败"""
    pass


class ConnectionError(ProviderError):
    """连接失败"""
    pass


class NotFoundError(ProviderError):
    """资源不存在"""
    pass


class NotSupportedError(ProviderError):
    """不支持的 vendor 或操作"""
    pass
