"""
凭证解析器

根据 Repository 或 JenkinsJob 绑定的 credential 直接解析出实际可用的凭证数据。
绑定阶段已在序列化器校验凭证来源（个人 / 项目）与类型，运行时只需读取绑定的凭证。

每次成功解析后更新凭证的 last_used_at 并写入一条使用记录（操作日志），供凭证详情页
「使用记录」Tab 展示。
"""
from django.utils import timezone

from .exceptions import ProviderError


# vendor 与凭证类型的对应关系（供序列化器绑定时校验）
VENDOR_TO_CRED_TYPE = {
    "gitlab": "gitlab_token",
    "gitea": "gitea_token",
    "github": "github_token",
    "gitee": "gitee_token",
    "svn": "svn_password",
    "jenkins": "jenkins_token",
}


def _module_for_source(source) -> str:
    """根据 source 类型返回使用记录模块名。"""
    from apps.repository.models import Repository
    from apps.jenkins.models import JenkinsJob

    if isinstance(source, Repository):
        return "代码仓库"
    if isinstance(source, JenkinsJob):
        return "Jenkins"
    return "未知模块"


def _resource_display(source) -> str:
    """生成资源展示名称。"""
    from apps.repository.models import Repository
    from apps.jenkins.models import JenkinsJob

    if isinstance(source, Repository):
        return f"{source.project.name if source.project else '-'} / {source.name}"
    if isinstance(source, JenkinsJob):
        return f"{source.project.name if source.project else '-'} / {source.name}"
    return str(source)


def resolve_credential(source, request_user=None) -> dict:
    """
    读取 source 绑定的凭证并返回解密后的数据。

    source 需具备属性：credential（绑定的 Credential 实例）。
    返回解密后的 dict，例如 {"token": "xxx"} 或 {"username": "x", "password": "y"}。

    Args:
        source: Repository 或 JenkinsJob 实例
        request_user: 当前请求用户（保留形参以减少调用点改动，当前未使用）

    Returns:
        解密后的凭证字典

    Raises:
        ProviderError: 未绑定凭证或凭证已停用时抛出
    """
    credential = source.credential

    if not credential or not credential.is_active:
        raise ProviderError("未找到可用的凭证")

    # 更新最后使用时间
    credential.last_used_at = timezone.now()
    credential.save(update_fields=["last_used_at"])

    # 写入使用记录（异步静默，失败不影响主流程）
    try:
        from apps.system.services import OperationLogService

        OperationLogService.log(
            user=request_user,
            module="凭证管理",
            action="使用凭证",
            resource_type="credential",
            resource_id=str(credential.id),
            description=f"{_module_for_source(source)} 使用凭证 {_resource_display(source)}",
            result="success",
            detail={"module": _module_for_source(source), "source_id": str(source.id)},
        )
    except Exception:
        pass

    return credential.get_data()
