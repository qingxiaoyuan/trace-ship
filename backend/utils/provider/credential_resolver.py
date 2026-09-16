"""
凭证解析器

产品通过「仓库所有者必须是产品成员」获得该仓库绑定凭证的使用权。
不把个人凭证改成共享服务账号；使用者始终看不到明文。

每次成功解析后更新凭证的 last_used_at 并写入使用记录。
"""
import logging

from django.utils import timezone

from .exceptions import ProviderError

logger = logging.getLogger(__name__)

# vendor 与凭证类型的对应关系（供序列化器绑定时校验）
# svn 保留：打包产物推送（PackageConfig.svn_credential）仍使用 svn_password 凭证
VENDOR_TO_CRED_TYPE = {
    "gitlab": "gitlab_token",
    "svn": "svn_password",
}


def _module_for_source(source) -> str:
    """根据 source 类型返回使用记录模块名。"""
    from apps.repository.models import Repository

    if isinstance(source, Repository):
        return "代码仓库"
    return "未知模块"


def _resource_display(source) -> str:
    """生成资源展示名称。"""
    from apps.repository.models import Repository

    if isinstance(source, Repository):
        return f"{source.project.name if source.project else '-'} / {source.name}"
    return str(source)


def _log_usage(
    *,
    request_user,
    credential,
    product,
    repository,
    product_component,
    operation: str,
    result: str,
    failure_reason: str = "",
    loan=None,
) -> None:
    """写入凭证使用审计；失败只记日志，不阻断主流程。"""
    try:
        from apps.credential.models import CredentialUsageLog

        CredentialUsageLog.objects.create(
            actor=request_user,
            lender=getattr(loan, "lender", None) or getattr(credential, "owner", None),
            credential=credential,
            loan=loan,
            product=product,
            repository=repository,
            product_component=product_component,
            operation=operation,
            result=result,
            failure_reason=failure_reason,
        )
    except Exception:
        logger.exception("写入凭证使用审计失败 operation=%s result=%s", operation, result)


def resolve_credential(
    source,
    request_user=None,
    *,
    product=None,
    loan=None,
    operation: str = "read",
    product_component=None,
) -> dict:
    """
    读取 source 绑定的凭证并返回解密后的数据。

    产品上下文：仓库所有者必须仍是该产品成员，才能使用仓库绑定的个人凭证。
    无产品时：操作者须为仓库所有者，或属于任一已关联且所有者仍在成员中的产品。
    开放接口 / 系统任务（无 request_user）继续使用绑定凭证。

    Args:
        source: Repository 实例
        request_user: 当前请求用户
        product: 产品上下文；发布、打包、产品内仓库操作应传入
        loan: 可选的显式借用记录，仅作附加约束，不再作为主授权方式
        operation: 操作类型，写入审计
        product_component: 产品组件，写入审计

    Returns:
        解密后的凭证字典

    Raises:
        ProviderError: 未绑定凭证、停用或当前产品无权使用时抛出
    """
    from apps.project.services import (
        is_repository_owner_in_product,
        repository_owner,
        repository_owner_association_error,
        user_can_use_repository_credential,
    )
    from apps.repository.models import Repository

    repository = source if isinstance(source, Repository) else getattr(source, "repository", None)
    credential = getattr(source, "credential", None)
    selected_loan = loan

    if product is not None:
        reason = repository_owner_association_error(source, product)
        if reason:
            if credential is not None:
                _log_usage(
                    request_user=request_user,
                    credential=credential,
                    product=product,
                    repository=repository,
                    product_component=product_component,
                    operation=operation,
                    result="failure",
                    failure_reason=reason,
                    loan=selected_loan,
                )
            raise ProviderError(reason)
        if not is_repository_owner_in_product(source, product):
            reason = "仓库所有者不在当前产品成员中，无法使用该仓库凭证"
            if credential is not None:
                _log_usage(
                    request_user=request_user,
                    credential=credential,
                    product=product,
                    repository=repository,
                    product_component=product_component,
                    operation=operation,
                    result="failure",
                    failure_reason=reason,
                    loan=selected_loan,
                )
            raise ProviderError(reason)
        if selected_loan is not None:
            from apps.credential.models import RepositoryCredentialLoan

            raw_loan = selected_loan
            if not isinstance(raw_loan, RepositoryCredentialLoan):
                raw_loan = RepositoryCredentialLoan.objects.filter(
                    id=getattr(selected_loan, "id", selected_loan)
                ).select_related("credential", "lender").first()
            if raw_loan is None or not raw_loan.is_valid_for(product, operation):
                reason = f"指定的凭证借用不能执行 {operation}"
                if raw_loan is not None:
                    _log_usage(
                        request_user=request_user,
                        credential=raw_loan.credential,
                        product=product,
                        repository=repository,
                        product_component=product_component,
                        operation=operation,
                        result="failure",
                        failure_reason=reason,
                        loan=raw_loan,
                    )
                raise ProviderError(reason)
            selected_loan = raw_loan
            credential = raw_loan.credential
    elif request_user is not None and not getattr(request_user, "is_superuser", False):
        if not user_can_use_repository_credential(source, request_user):
            reason = "当前用户无权使用该仓库凭证。请先将仓库所有者加入产品成员，再从产品关联该仓库"
            if credential is not None:
                _log_usage(
                    request_user=request_user,
                    credential=credential,
                    product=None,
                    repository=repository,
                    product_component=product_component,
                    operation=operation,
                    result="failure",
                    failure_reason=reason,
                )
            raise ProviderError(reason)

    if not credential or not credential.is_active:
        raise ProviderError("未找到可用的凭证")

    owner = repository_owner(source)
    if (
        owner is not None
        and not credential.is_system_shared
        and str(credential.owner_id) != str(owner.id)
    ):
        raise ProviderError("仓库绑定凭证不属于仓库所有者")

    credential.last_used_at = timezone.now()
    credential.save(update_fields=["last_used_at"])

    _log_usage(
        request_user=request_user,
        credential=credential,
        product=product,
        repository=repository,
        product_component=product_component,
        operation=operation,
        result="success",
        loan=selected_loan,
    )
    if selected_loan is None and product is None:
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
            logger.exception("写入通用凭证操作日志失败")

    return credential.get_data()
