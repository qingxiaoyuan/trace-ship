from rest_framework.response import Response


def success_response(data=None, message="success", status=200):
    """统一成功响应"""
    return Response({
        "code": 0,
        "message": message,
        "data": data if data is not None else {},
    }, status=status)


def error_response(code, message, data=None, status_code=400):
    """统一错误响应"""
    return Response({
        "code": code,
        "message": message,
        "data": data if data is not None else None,
    }, status=status_code)
