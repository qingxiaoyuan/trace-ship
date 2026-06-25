"""
自定义中间件

提供操作日志自动记录和统一异常处理补充能力。
"""
import time
from django.utils.deprecation import MiddlewareMixin


class OperationLogMiddleware(MiddlewareMixin):
    """
    操作日志中间件

    自动记录已认证用户的请求路径、方法、状态码、耗时和 IP。
    健康检查、API 文档等路径会被跳过；高频只读列表查询也会跳过。
    """

    # 不需要记录操作日志的路径前缀
    EXCLUDED_PATHS = {
        "/health/",
        "/api/schema/",
        "/swagger/",
        "/redoc/",
        "/static/",
    }

    # 高频只读路径后缀，避免日志爆炸
    EXCLUDED_SUFFIXES = ("/", "/list", "/todo", "/done")

    def process_request(self, request):
        """记录请求开始时间"""
        request._start_time = time.time()

    def process_response(self, request, response):
        """
        记录操作日志

        对未登录用户和排除路径不记录；记录异常时不影响主流程。
        """
        path = request.path
        if any(path.startswith(p) for p in self.EXCLUDED_PATHS):
            return response

        user = request.user if request.user.is_authenticated else None
        if not user:
            return response

        method = request.method.upper()
        # 跳过 GET 列表查询
        if method == "GET" and any(path.endswith(s) for s in self.EXCLUDED_SUFFIXES):
            return response

        try:
            from apps.system.models import OperationLog

            module = path.split("/")[2] if len(path.split("/")) > 2 else "unknown"
            action = method.lower()
            duration = int((time.time() - getattr(request, "_start_time", time.time())) * 1000)

            OperationLog.objects.create(
                user=user,
                module=module,
                action=action,
                resource_type=module,
                resource_id="",
                detail={
                    "path": path,
                    "method": method,
                    "status_code": response.status_code,
                    "duration_ms": duration,
                    "ip": self.get_client_ip(request),
                },
                result="success" if response.status_code < 400 else "failure",
                ip=self.get_client_ip(request),
            )
        except Exception:
            # 操作日志记录失败不应影响主流程
            pass

        return response

    @staticmethod
    def get_client_ip(request) -> str:
        """
        获取客户端真实 IP

        Args:
            request: Django HttpRequest

        Returns:
            客户端 IP 字符串
        """
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")


class ExceptionHandlerMiddleware(MiddlewareMixin):
    """
    统一异常处理中间件（补充 DRF exception_handler）

    当前为占位实现，可在此扩展中间件级别的异常处理。
    """

    def process_exception(self, request, exception):
        """处理未捕获异常"""
        return None
