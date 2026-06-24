"""
全局异常处理

统一 DRF 异常响应格式为 {code, message, data}，便于前端统一处理。
"""
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status
from django.core.exceptions import ValidationError, PermissionDenied
from django.http import Http404


def custom_exception_handler(exc, context) -> Response:
    """
    统一异常处理函数

    将 DRF 内置异常、Django 校验/权限/404 异常以及未知异常统一包装为项目标准响应格式。

    Args:
        exc: 异常实例
        context: 异常上下文（包含 view、request 等）

    Returns:
        统一格式 Response
    """
    response = exception_handler(exc, context)

    if response is not None:
        code = response.status_code * 100 if response.status_code < 600 else 50000
        message = response.data.get("detail", "请求失败")
        if isinstance(response.data, dict) and "detail" not in response.data:
            message = "参数错误"
        return Response({
            "code": code,
            "message": message,
            "data": response.data,
        }, status=response.status_code)

    if isinstance(exc, ValidationError):
        return Response({
            "code": 40001,
            "message": "参数校验失败",
            "data": exc.message_dict if hasattr(exc, "message_dict") else {"error": str(exc)},
        }, status=status.HTTP_400_BAD_REQUEST)

    if isinstance(exc, PermissionDenied):
        return Response({
            "code": 40300,
            "message": "无权限访问",
            "data": None,
        }, status=status.HTTP_403_FORBIDDEN)

    if isinstance(exc, Http404):
        return Response({
            "code": 40400,
            "message": "资源不存在",
            "data": None,
        }, status=status.HTTP_404_NOT_FOUND)

    # 未知异常
    return Response({
        "code": 50000,
        "message": "服务器内部错误",
        "data": {"detail": str(exc)},
    }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
