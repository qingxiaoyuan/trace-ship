"""
账号管理视图

提供认证相关接口（登录、登出、Token 刷新、用户信息、菜单）以及
用户、角色、权限的 CRUD 管理接口。
"""

from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from apps.account.models import Permission, Role, User, UserRole
from apps.account.serializers import (
    LoginSerializer,
    PermissionSerializer,
    RoleSerializer,
    UserBriefSerializer,
    UserCreateSerializer,
    UserInfoSerializer,
    UserSerializer,
)
from utils.permissions import HasPermission
from utils.response import error_response, success_response
from utils.viewsets import StandardModelViewSet


def create_operation_log(
    user: User | None,
    module: str,
    action: str,
    resource_type: str,
    resource_id: str,
    detail: dict,
    ip: str,
) -> None:
    """
    创建操作日志

    记录用户关键操作，异常时不影响主流程。

    Args:
        user: 操作用户，未登录时为 None
        module: 功能模块名称
        action: 操作动作
        resource_type: 资源类型
        resource_id: 资源标识
        detail: 详细内容字典
        ip: 客户端 IP
    """
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
    """
    认证视图集

    开放接口（无需登录）：
        POST /login/          登录（LDAP 优先，本地兜底）
        POST /token/refresh/  刷新 Access Token
        POST /logout/         登出并黑名单 Refresh Token

    需登录接口：
        GET  /user-info/      当前用户信息
        GET  /menus/          侧边栏菜单
    """

    permission_classes = [AllowAny]
    serializer_class = LoginSerializer

    def get_serializer_class(self):
        """
        根据当前 action 返回对应序列化器

        Returns:
            当前 action 使用的 Serializer 类
        """
        if self.action == "login":
            return LoginSerializer
        if self.action == "token_refresh":
            from rest_framework_simplejwt.serializers import TokenRefreshSerializer
            return TokenRefreshSerializer
        return self.serializer_class

    @action(detail=False, methods=["post"], url_path="login")
    def login(self, request: Request) -> Response:
        """
        用户登录接口

        先尝试 LDAP 认证，失败后再使用本地账号认证；认证成功后颁发 JWT Token。

        Args:
            request: DRF Request，body 需包含 username 和 password

        Returns:
            成功返回用户信息及双 Token，失败返回 401
        """
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username: str = serializer.validated_data["username"]
        password: str = serializer.validated_data["password"]

        user: User | None = None
        error_msg = ""

        # 1. 尝试 LDAP 认证（配置来源：「系统配置」页面 ldap_* 键优先，环境变量兜底）
        from apps.account.ldap_config import authenticate_ldap, parse_ldap_display_name

        try:
            ldap_user = authenticate_ldap(request, username, password)
            if ldap_user and isinstance(ldap_user, User):
                # django-auth-ldap 已完成建用户（username 按 iexact 匹配、统一小写落库），
                # 此处仅同步附加字段，切勿再按原始输入 get_or_create，否则大小写差异会产生重复用户
                display_name = getattr(ldap_user, "first_name", "") or ""
                department, real_name = parse_ldap_display_name(display_name)
                ldap_user.source = "ldap"
                ldap_user.nickname = real_name or ldap_user.username
                ldap_user.department = department
                ldap_user.last_login = timezone.now()
                ldap_user.save(update_fields=["source", "nickname", "department", "last_login"])
                # LDAP 用户没有任何角色时默认赋予开发人员角色
                if not ldap_user.user_roles.exists():
                    developer_role = Role.objects.filter(code="developer").first()
                    if developer_role:
                        UserRole.objects.get_or_create(user=ldap_user, role=developer_role)
                user = ldap_user
        except Exception as e:
            error_msg = str(e)

        # 2. LDAP 失败或未启用，尝试本地认证
        if not user:
            local_auth_user = authenticate(request, username=username, password=password)
            if local_auth_user and isinstance(local_auth_user, User) and local_auth_user.source == "local":
                user = local_auth_user

        if not user:
            return error_response(40100, "用户名或密码错误", {"detail": error_msg}, status_code=status.HTTP_401_UNAUTHORIZED)

        if not user.is_active:
            return error_response(40100, "账号已停用", status_code=status.HTTP_401_UNAUTHORIZED)

        # 生成 JWT Token
        refresh = RefreshToken.for_user(user)

        # 记录登录日志
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
    def token_refresh(self, request: Request) -> Response:
        """
        刷新 Access Token

        使用有效的 Refresh Token 换取新的 Access/Refresh Token 对。

        Args:
            request: DRF Request，body 需包含 refresh

        Returns:
            成功返回新 Token，失败返回 401
        """
        from rest_framework_simplejwt.views import TokenRefreshView
        response = TokenRefreshView.as_view()(request._request)
        if response.status_code == 200:
            return success_response(response.data)
        return error_response(40100, "Token 刷新失败", response.data, status_code=response.status_code)

    @action(detail=False, methods=["post"], url_path="logout")
    def logout(self, request: Request) -> Response:
        """
        用户登出接口

        将传入的 Refresh Token 加入黑名单，使其无法再刷新 Token。

        Args:
            request: DRF Request，body 可包含 refresh

        Returns:
            统一成功响应
        """
        try:
            refresh_token = request.data.get("refresh")
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
        except Exception:
            pass
        return success_response(None, "登出成功")

    @action(detail=False, methods=["get"], url_path="user-info", permission_classes=[IsAuthenticated])
    def user_info(self, request: Request) -> Response:
        """
        获取当前登录用户信息

        Args:
            request: 已认证的 DRF Request

        Returns:
            当前用户详情
        """
        serializer = UserInfoSerializer(request.user)
        return success_response(serializer.data)

    @action(detail=False, methods=["get"], url_path="menus", permission_classes=[IsAuthenticated])
    def menus(self, request: Request) -> Response:
        """
        获取当前用户侧边栏菜单

        根据用户角色拥有的权限模块动态过滤菜单项。超管返回全部菜单。
        只要用户是任一项目的成员，即放开全部业务菜单（项目/仓库/发布/
        工作流/提交审查/打包），写操作仍由接口按项目角色拦截；
        凭证管理菜单维持按系统角色权限过滤。

        Args:
            request: 已认证的 DRF Request

        Returns:
            菜单结构列表
        """
        # 全量菜单定义：每项关联所需权限模块
        all_menus = [
            {"id": "dashboard", "name": "工作台", "path": "/dashboard", "icon": "AppstoreOutlined", "modules": []},
            {"id": "releases", "name": "发布看板", "path": "/releases", "icon": "RocketOutlined", "modules": ["release"]},
            {"id": "workflows", "name": "工作流审批", "path": "/workflows", "icon": "ProfileOutlined", "modules": ["workflow"]},
            {"id": "notifications", "name": "通知中心", "path": "/notifications", "icon": "BellOutlined", "modules": []},
            {"id": "guide", "name": "使用说明", "path": "/guide", "icon": "ReadOutlined", "modules": []},
            {"id": "feedback", "name": "使用反馈", "path": "/feedback", "icon": "MessageOutlined", "modules": []},
            {"id": "changelog", "name": "更新日志", "path": "/changelog", "icon": "FileTextOutlined", "modules": []},
            {"id": "projects", "name": "项目管理", "path": "/projects", "icon": "FolderOutlined", "modules": ["project"]},
            {"id": "repositories", "name": "仓库管理", "path": "/repositories", "icon": "DatabaseOutlined", "modules": ["repository"]},
            {"id": "credentials", "name": "凭证管理", "path": "/credentials", "icon": "KeyOutlined", "modules": ["credential"]},
            {"id": "packages", "name": "打包任务", "path": "/packages", "icon": "PlayCircleOutlined", "modules": ["package"]},
            {"id": "commits", "name": "提交规范审查", "path": "/commits", "icon": "FileTextOutlined", "modules": ["commit"]},
            {"id": "tags", "name": "新建发布", "path": "/releases/create", "icon": "TagsOutlined", "modules": ["release"]},
            {
                "id": "system",
                "name": "系统管理",
                "path": "/system",
                "icon": "SettingOutlined",
                # 父级不限制模块，按子菜单权限过滤（子项全不可见时父级自动隐藏）
                "modules": [],
                "children": [
                    {"id": "system_users", "name": "用户管理", "path": "/system/users", "icon": "TeamOutlined", "permission": "system.user"},
                    {"id": "system_roles", "name": "角色管理", "path": "/system/roles", "icon": "SafetyCertificateOutlined", "permission": "system.role"},
                    {"id": "system_configs", "name": "系统配置", "path": "/system/configs", "icon": "SettingOutlined", "permission": "system.config"},
                    {"id": "system_package_images", "name": "打包镜像", "path": "/system/package-images", "icon": "BoxPlotOutlined", "permission": "system.package_image"},
                    {"id": "system_access_tokens", "name": "访问令牌", "path": "/system/access-tokens", "icon": "KeyOutlined", "permission": "system.access_token"},
                    {"id": "system_logs", "name": "操作日志", "path": "/system/logs", "icon": "FileTextOutlined", "permission": "system.log"},
                ],
            },
        ]

        user = request.user

        # 超管返回全部菜单
        if user.is_superuser:
            return success_response(all_menus)

        # 收集当前用户所有角色关联的权限模块与权限编码
        user_permissions = set(
            user.user_roles.values_list("role__permissions__code", flat=True)
        )
        user_modules = set(
            user.user_roles.values_list("role__permissions__module", flat=True)
        )

        # 项目成员放开业务菜单（写操作仍由接口按项目角色拦截）；
        # credential 模块不在放开范围内，凭证菜单维持按权限过滤
        from apps.project.services import visible_project_ids

        if visible_project_ids(user).exists():
            user_modules |= {"project", "repository", "release", "workflow", "commit", "package"}

        # 按权限过滤菜单：优先校验 permission（精确权限码），其次按 modules 模块
        def filter_menu(menu: dict) -> dict | None:
            """过滤单个菜单项，无权限返回 None"""
            perm = menu.get("permission")
            required = menu.get("modules", [])
            if perm:
                if perm not in user_permissions:
                    return None
            elif required and not any(m in user_modules for m in required):
                return None
            result = dict(menu)
            result.pop("modules", None)
            result.pop("permission", None)
            if "children" in menu:
                filtered_children = [
                    c for c in (filter_menu(child) for child in menu["children"])
                    if c is not None
                ]
                # 子菜单全被过滤掉则隐藏父菜单
                if menu["children"] and not filtered_children:
                    return None
                result["children"] = filtered_children
            return result

        filtered = [m for m in (filter_menu(menu) for menu in all_menus) if m is not None]
        return success_response(filtered)

    @staticmethod
    def get_client_ip(request: Request) -> str:
        """
        获取客户端真实 IP

        优先从 X-Forwarded-For 头部获取，无代理时取 REMOTE_ADDR。

        Args:
            request: DRF Request

        Returns:
            客户端 IP 字符串
        """
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")


class UserViewSet(StandardModelViewSet):
    """
    用户管理视图集

    人员查询（列表/详情）全员可查：普通用户返回精简字段，超管返回完整字段；
    创建/删除需超管，普通用户仅可修改自己。
    """

    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    @property
    def _has_system_user_perm(self) -> bool:
        """当前用户是否拥有 system.user 权限（单次请求内缓存）"""
        if not hasattr(self, "_cached_has_system_user"):
            user = self.request.user
            self._cached_has_system_user = (
                not user.is_superuser
                and user.user_roles.filter(role__permissions__code="system.user").exists()
            )
        return self._cached_has_system_user

    def get_queryset(self):
        """
        根据当前用户身份与操作返回查询集

        超管返回全部用户；拥有 system.user 权限可管理全部用户；
        普通用户读操作（人员查询）返回全部用户，写操作仅返回自己；
        预加载角色关联以避免 N+1 查询。

        Returns:
            当前身份与操作可见的用户查询集
        """
        if getattr(self, "swagger_fake_view", False):
            return User.objects.none()
        user = self.request.user
        if user.is_superuser or self.action in ["list", "retrieve"]:
            return User.objects.all().prefetch_related("user_roles__role")
        # 拥有 system.user 权限可管理全部用户，否则仅可操作自己
        if self._has_system_user_perm:
            return User.objects.all().prefetch_related("user_roles__role")
        return User.objects.filter(id=user.id).prefetch_related("user_roles__role")

    def get_serializer_class(self):
        """
        写操作使用 UserCreateSerializer；读操作超管或拥有 system.user 权限
        使用 UserSerializer，普通用户查看他人使用 UserBriefSerializer
        （查看自己仍返回完整字段）

        Returns:
            当前 action 对应的 Serializer 类
        """
        if self.action in ["create", "update", "partial_update"]:
            return UserCreateSerializer
        user = self.request.user
        if user.is_superuser or self._has_system_user_perm:
            return UserSerializer
        if self.action == "retrieve" and str(self.kwargs.get("pk")) == str(user.id):
            return UserSerializer
        return UserBriefSerializer

    def get_permissions(self):
        """
        创建和删除用户需要 system.user 权限（超管自动放行）

        Returns:
            当前 action 对应的权限实例列表
        """
        if self.action in ["create", "destroy"]:
            return [IsAuthenticated(), HasPermission("system.user")]
        return super().get_permissions()

    def perform_create(self, serializer):
        """
        执行用户创建

        Args:
            serializer: 已校验的 UserCreateSerializer 实例
        """
        serializer.save()


class RoleViewSet(StandardModelViewSet):
    """
    角色管理视图集

    查询（列表/详情）所有登录用户可用（用户表单需加载角色列表）；
    增删改需要 system.role 权限（超管自动放行）。
    """

    queryset = Role.objects.all().prefetch_related("permissions")
    serializer_class = RoleSerializer

    def get_permissions(self):
        """读操作放开给登录用户，写操作需要 system.role 权限"""
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), HasPermission("system.role")]
        return [IsAuthenticated()]


class PermissionViewSet(StandardModelViewSet):
    """
    权限管理视图集

    提供权限列表查询，需要 system.role 权限（角色管理时加载权限树），
    超管自动放行，且只允许 GET 请求。
    """

    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    http_method_names = ["get", "head"]

    def get_permissions(self):
        """权限列表查询需要 system.role 权限（超管自动放行）"""
        return [IsAuthenticated(), HasPermission("system.role")]
