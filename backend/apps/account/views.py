from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from apps.account.models import User, Role, Permission
from apps.account.serializers import (
    UserSerializer, UserCreateSerializer, RoleSerializer,
    PermissionSerializer, LoginSerializer, UserInfoSerializer,
)
from utils.permissions import IsSuperUser
from utils.response import success_response, error_response


def create_operation_log(user, module, action, resource_type, resource_id, detail, ip):
    """创建操作日志"""
    try:
        from apps.system.models import OperationLog
        OperationLog.objects.create(
            user=user,
            module=module,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            detail=detail,
            ip=ip,
        )
    except Exception:
        pass


class AuthViewSet(viewsets.GenericViewSet):
    permission_classes = [AllowAny]
    serializer_class = LoginSerializer

    def get_serializer_class(self):
        if self.action == "login":
            return LoginSerializer
        if self.action == "token_refresh":
            from rest_framework_simplejwt.serializers import TokenRefreshSerializer
            return TokenRefreshSerializer
        return self.serializer_class

    @action(detail=False, methods=["post"], url_path="login")
    def login(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data["username"]
        password = serializer.validated_data["password"]

        user = None
        error_msg = ""

        # 1. 尝试 LDAP 认证
        try:
            from django_auth_ldap.backend import LDAPBackend
            ldap_backend = LDAPBackend()
            ldap_user = ldap_backend.authenticate(request, username=username, password=password)
            if ldap_user and isinstance(ldap_user, User):
                # 同步/更新本地用户记录
                local_user, created = User.objects.get_or_create(
                    username=username,
                    defaults={
                        "source": "ldap",
                        "nickname": getattr(ldap_user, "first_name", username),
                        "email": getattr(ldap_user, "email", ""),
                    },
                )
                if not created:
                    local_user.source = "ldap"
                    local_user.last_login = timezone.now()
                    local_user.save(update_fields=["source", "last_login"])
                user = local_user
        except Exception as e:
            error_msg = str(e)

        # 2. LDAP 失败，尝试本地认证
        if not user:
            local_auth_user = authenticate(request, username=username, password=password)
            if local_auth_user and isinstance(local_auth_user, User) and local_auth_user.source == "local":
                user = local_auth_user

        if not user:
            return error_response(40100, "用户名或密码错误", {"detail": error_msg}, status_code=status.HTTP_401_UNAUTHORIZED)

        if not user.is_active:
            return error_response(40100, "账号已停用", status_code=status.HTTP_401_UNAUTHORIZED)

        refresh = RefreshToken.for_user(user)

        create_operation_log(
            user=user,
            module="auth",
            action="login",
            resource_type="user",
            resource_id=str(user.id),
            detail={"ip": self.get_client_ip(request)},
            ip=self.get_client_ip(request),
        )

        return success_response({
            "user_id": str(user.id),
            "username": user.username,
            "nickname": user.nickname,
            "access_token": str(refresh.access_token),
            "refresh_token": str(refresh),
            "expires_in": 3600,
        })

    @action(detail=False, methods=["post"], url_path="token/refresh")
    def token_refresh(self, request):
        from rest_framework_simplejwt.views import TokenRefreshView
        response = TokenRefreshView.as_view()(request._request)
        if response.status_code == 200:
            return success_response(response.data)
        return error_response(40100, "Token 刷新失败", response.data, status_code=response.status_code)

    @action(detail=False, methods=["post"], url_path="logout")
    def logout(self, request):
        try:
            refresh_token = request.data.get("refresh")
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
        except Exception:
            pass
        return success_response(None, "登出成功")

    @action(detail=False, methods=["get"], url_path="user-info", permission_classes=[IsAuthenticated])
    def user_info(self, request):
        serializer = UserInfoSerializer(request.user)
        return success_response(serializer.data)

    @action(detail=False, methods=["get"], url_path="menus", permission_classes=[IsAuthenticated])
    def menus(self, request):
        # 简化菜单，后续可根据角色权限动态生成
        menus = [
            {"id": "dashboard", "name": "工作台", "path": "/dashboard", "icon": "AppstoreOutlined"},
            {"id": "projects", "name": "项目管理", "path": "/projects", "icon": "FolderOutlined"},
            {"id": "repositories", "name": "仓库管理", "path": "/repositories", "icon": "DatabaseOutlined"},
            {"id": "credentials", "name": "凭证管理", "path": "/credentials", "icon": "KeyOutlined"},
            {"id": "commits", "name": "提交规范审查", "path": "/commits", "icon": "FileTextOutlined"},
            {"id": "tags", "name": "Tag 生成与发布", "path": "/tags", "icon": "TagsOutlined"},
            {"id": "jenkins", "name": "Jenkins构建", "path": "/jenkins", "icon": "PlayCircleOutlined"},
            {"id": "workflows", "name": "工作流审批", "path": "/workflows", "icon": "ProfileOutlined"},
            {"id": "system", "name": "系统管理", "path": "/system", "icon": "SettingOutlined"},
        ]
        if request.user.is_superuser:
            menus.append({"id": "account", "name": "账号管理", "path": "/account", "icon": "UserOutlined"})
        return success_response(menus)

    @staticmethod
    def get_client_ip(request):
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return User.objects.none()
        if self.request.user.is_superuser:
            return User.objects.all()
        return User.objects.filter(id=self.request.user.id)

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return UserCreateSerializer
        return UserSerializer

    def get_permissions(self):
        if self.action in ["create", "destroy"]:
            return [IsAuthenticated(), IsSuperUser()]
        return super().get_permissions()

    def perform_create(self, serializer):
        serializer.save()


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated, IsSuperUser]


class PermissionViewSet(viewsets.ModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [IsAuthenticated, IsSuperUser]
    http_method_names = ["get", "head"]
