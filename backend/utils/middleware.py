import json
import time
from django.utils.deprecation import MiddlewareMixin
from django.utils import timezone


class OperationLogMiddleware(MiddlewareMixin):
    """操作日志中间件"""

    EXCLUDED_PATHS = {"/health/", "/api/schema/", "/swagger/", "/redoc/", "/static/"}

    def process_request(self, request):
        request._start_time = time.time()

    def process_response(self, request, response):
        path = request.path
        if any(path.startswith(p) for p in self.EXCLUDED_PATHS):
            return response

        user = request.user if request.user.is_authenticated else None
        if not user:
            return response

        try:
            from apps.system.models import OperationLog

            module = path.split("/")[2] if len(path.split("/")) > 2 else "unknown"
            action = request.method.lower()
            duration = int((time.time() - getattr(request, "_start_time", time.time())) * 1000)

            OperationLog.objects.create(
                user=user,
                module=module,
                action=action,
                resource_type=module,
                resource_id="",
                detail={
                    "path": path,
                    "method": request.method,
                    "status_code": response.status_code,
                    "duration_ms": duration,
                    "ip": self.get_client_ip(request),
                },
                ip=self.get_client_ip(request),
            )
        except Exception:
            # 操作日志记录失败不应影响主流程
            pass

        return response

    @staticmethod
    def get_client_ip(request):
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")


class ExceptionHandlerMiddleware(MiddlewareMixin):
    """统一异常处理中间件（补充 DRF exception_handler）"""

    def process_exception(self, request, exception):
        return None
