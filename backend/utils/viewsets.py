"""
统一视图集基类

扩展 DRF 默认 ModelViewSet / ReadOnlyModelViewSet，自动把成功响应包装为
项目标准格式 {code, message, data}。
"""
from typing import Any

from rest_framework import viewsets
from rest_framework.response import Response

from utils.response import success_response


class StandardResponseMixin:
    """
    标准响应包装 Mixin

    对 DRF 默认返回的 JSON 成功响应（retrieve / create / update / destroy
    / partial_update 等）进行统一包装。若响应已包含 code 字段（如分页器
    已包装或视图已手动调用 success_response），则直接透传。
    """

    def _wrap_response(self, response: Response, message: str = "success") -> Response:
        """
        将 DRF Response 包装为标准格式

        Args:
            response: DRF 原始响应
            message: 成功提示语

        Returns:
            标准格式 Response
        """
        data = response.data
        # 已包装或二进制/空响应不重复处理（destroy 除外）
        if isinstance(data, dict) and "code" in data:
            return response
        if data is None and response.status_code == 204:
            return success_response(None, message)
        if isinstance(data, (dict, list)):
            return success_response(data, message)
        return response

    def retrieve(self, request, *args, **kwargs) -> Response:
        """查询单个对象并包装为标准响应"""
        response = super().retrieve(request, *args, **kwargs)
        return self._wrap_response(response)

    def create(self, request, *args, **kwargs) -> Response:
        """创建对象并包装为标准响应"""
        response = super().create(request, *args, **kwargs)
        return self._wrap_response(response, "创建成功")

    def update(self, request, *args, **kwargs) -> Response:
        """全量更新并包装为标准响应"""
        response = super().update(request, *args, **kwargs)
        return self._wrap_response(response, "更新成功")

    def partial_update(self, request, *args, **kwargs) -> Response:
        """部分更新并包装为标准响应"""
        response = super().partial_update(request, *args, **kwargs)
        return self._wrap_response(response, "更新成功")

    def destroy(self, request, *args, **kwargs) -> Response:
        """删除对象并返回标准成功响应"""
        response = super().destroy(request, *args, **kwargs)
        return self._wrap_response(response, "删除成功")

    def list(self, request, *args, **kwargs) -> Response:
        """
        列表查询

        默认分页器（StandardPagination）已经包装为标准格式；若某个接口禁用
        分页，则在此处兜底包装。
        """
        response = super().list(request, *args, **kwargs)
        return self._wrap_response(response)


class StandardModelViewSet(StandardResponseMixin, viewsets.ModelViewSet):
    """
    标准 ModelViewSet

    所有未被子类重写的方法都会自动包装为 {code, message, data}。
    """
    pass


class StandardReadOnlyModelViewSet(StandardResponseMixin, viewsets.ReadOnlyModelViewSet):
    """
    标准 ReadOnlyModelViewSet

    只读接口自动包装为标准响应格式。
    """
    pass
