"""旧库尚未跑完新迁移时，按实际列查询仓库，避免 ORM 选出不存在的字段。"""
from django.db import connection
from django.db.models import QuerySet

from apps.repository.models import Repository


def missing_field_names(model) -> list[str]:
    """返回模型已声明、但当前数据库表还不存在的字段名。"""
    table = model._meta.db_table
    if table not in set(connection.introspection.table_names()):
        return [field.name for field in model._meta.concrete_fields]
    with connection.cursor() as cursor:
        existing = {
            column.name for column in connection.introspection.get_table_description(cursor, table)
        }
    return [
        field.name
        for field in model._meta.concrete_fields
        if field.column not in existing
    ]


def has_column(model, column: str) -> bool:
    """当前库是否已有指定列。"""
    table = model._meta.db_table
    if table not in set(connection.introspection.table_names()):
        return False
    with connection.cursor() as cursor:
        columns = connection.introspection.get_table_description(cursor, table)
    return any(item.name == column for item in columns)


def repositories() -> QuerySet:
    """查询仓库时自动 defer 尚未迁移的列（如 created_by_id）。"""
    queryset = Repository.objects.all()
    missing = missing_field_names(Repository)
    if missing:
        queryset = queryset.defer(*missing)
    return queryset
