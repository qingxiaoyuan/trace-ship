"""
统一分页器

扩展 DRF 默认分页器，返回项目标准响应格式 {code, message, data}。
"""
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class StandardPagination(PageNumberPagination):
    """
    标准分页器

    Attributes:
        page_size: 默认每页条数
        page_size_query_param: 客户端可指定每页条数的参数名
        max_page_size: 每页最大条数
    """

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_paginated_response(self, data) -> Response:
        """
        构造统一分页响应

        Args:
            data: 当前页数据列表

        Returns:
            统一格式 Response
        """
        return Response({
            "code": 0,
            "message": "success",
            "data": {
                "total": self.page.paginator.count,
                "page": self.page.number,
                "page_size": self.get_page_size(self.request),
                "results": data,
            },
        })
