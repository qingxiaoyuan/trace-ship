"""
统一响应工具

封装成功/失败响应格式为 {code, message, data}。
"""
from typing import Any

from rest_framework.response import Response


def success_response(data: Any = None, message: str = "success", status: int = 200) -> Response:
    """
    统一成功响应

    Args:
        data: 响应数据，默认为空字典
        message: 提示信息
        status: HTTP 状态码

    Returns:
        DRF Response
    """
    return Response({
        "code": 0,
        "message": message,
        "data": data if data is not None else {},
    }, status=status)


def error_response(code: int, message: str, data: Any = None, status_code: int = 400) -> Response:
    """
    统一失败响应

    Args:
        code: 业务错误码
        message: 错误提示
        data: 错误详情
        status_code: HTTP 状态码

    Returns:
        DRF Response
    """
    return Response({
        "code": code,
        "message": message,
        "data": data if data is not None else None,
    }, status=status_code)
