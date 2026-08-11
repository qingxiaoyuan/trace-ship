"""
系统内置打包视图
"""
import os
import tempfile
import zipfile
from pathlib import Path

from django.http import FileResponse, Http404, HttpResponse
from django.db.models import Prefetch
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, serializers, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from apps.package.models import PackageConfig, PackageImage, PackageNode, PackageTask
from apps.package.docker_local import LocalDockerError, LocalDockerService
from apps.package.nexus import NexusError, NexusService
from apps.package.remote_windows import RemoteNodeError, test_node_connection
from apps.package.serializers import (
    PackageConfigSerializer,
    PackageImageSerializer,
    PackageNodeSerializer,
    PackageTaskSerializer,
)
from apps.package.services import PackageService
from apps.credential.models import Credential
from apps.project.models import Project
from apps.project.models import ProjectMember
from apps.project.services import visible_project_ids
from apps.release.models import ReleaseRecord
from utils.permissions import IsProjectManager, IsProjectMember, IsProjectPackager, IsProjectDeveloper, IsProjectPackageAdmin, HasPermission
from utils.provider.exceptions import AuthenticationError, ConnectionError, NotFoundError, ProviderError
from utils.provider.factory import get_provider
from utils.response import error_response, success_response
from utils.viewsets import StandardModelViewSet, StandardReadOnlyModelViewSet

class _TempFileResponse(FileResponse):
    """下载完成后自动删除临时 zip 文件的响应。"""

    def __init__(self, temp_path: str, *args, **kwargs):
        self._temp_path = temp_path
        super().__init__(open(temp_path, "rb"), *args, **kwargs)

    def close(self):
        super().close()
        try:
            os.remove(self._temp_path)
        except FileNotFoundError:
            pass



class PackageImageViewSet(StandardModelViewSet):
    """系统级打包镜像配置视图集。"""

    queryset = PackageImage.objects.all()
    serializer_class = PackageImageSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["source", "is_active"]
    search_fields = ["name", "image"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_permissions(self):
        # 镜像管理（增删改、导入 tar 包）需要 system.package_image 权限，超管自动放行
        if self.action in ("create", "update", "partial_update", "destroy", "import_image"):
            return [IsAuthenticated(), HasPermission("system.package_image")]
        return [IsAuthenticated()]

    # 允许导入的镜像包格式（docker load 支持 tar 及常见压缩格式）
    IMPORT_FILE_SUFFIXES = (".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz")

    @action(detail=False, methods=["post"], url_path="import")
    def import_image(self, request):
        """上传镜像 tar 包并导入本地 Docker（docker load），需要 system.package_image 权限。"""
        upload = request.FILES.get("file")
        if not upload:
            return error_response(40000, "请上传镜像 tar 文件", status_code=status.HTTP_400_BAD_REQUEST)
        filename = (upload.name or "").lower()
        if not filename.endswith(self.IMPORT_FILE_SUFFIXES):
            return error_response(
                40000,
                "文件格式不支持，请上传 .tar / .tar.gz / .tar.bz2 / .tar.xz 镜像包",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        # 落盘到临时文件供 docker load 读取，导入完成后删除
        fd, temp_path = tempfile.mkstemp(suffix=".tar", prefix="image_import_")
        try:
            with os.fdopen(fd, "wb") as temp_file:
                for chunk in upload.chunks():
                    temp_file.write(chunk)
            loaded = LocalDockerService.load_image(temp_path)
        except LocalDockerError as exc:
            return error_response(50000, str(exc), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
        finally:
            try:
                os.remove(temp_path)
            except FileNotFoundError:
                pass

        if not loaded:
            return success_response({"loaded": []}, "导入完成，但镜像包中未包含命名镜像")
        return success_response({"loaded": loaded}, f"已导入 {len(loaded)} 个镜像")

    @action(detail=False, methods=["get"], url_path="nexus-repositories")
    def nexus_repositories(self, request):
        """列出 Nexus 中 docker 格式的仓库，供打包镜像选择。"""
        try:
            data = NexusService.list_docker_repositories()
        except NexusError as exc:
            return error_response(50200, str(exc), status_code=status.HTTP_502_BAD_GATEWAY)
        return success_response(data)

    @action(detail=False, methods=["get"], url_path="nexus-images")
    def nexus_images(self, request):
        """在 Nexus 中搜索 docker 镜像，返回可选择的镜像地址。"""
        try:
            data = NexusService.search_docker_images(
                repository=request.query_params.get("repository", ""),
                keyword=request.query_params.get("keyword", ""),
                continuation_token=request.query_params.get("continuation_token", ""),
            )
        except NexusError as exc:
            return error_response(50200, str(exc), status_code=status.HTTP_502_BAD_GATEWAY)
        return success_response(data)

    @action(detail=False, methods=["get"], url_path="available")
    def available(self, request):
        """
        聚合列出可选打包镜像：本地 Docker + 已配置 Nexus。

        任一来源失败不影响另一来源返回，失败原因放在 errors 中。
        返回结构：{"items": [...], "errors": {"local": str, "nexus": str}}
        """
        keyword = request.query_params.get("keyword", "")
        source_filter = request.query_params.get("source", "")

        items: list[dict] = []
        errors: dict[str, str] = {}

        if source_filter in ("", "local"):
            try:
                items.extend(LocalDockerService.list_images(keyword=keyword))
            except LocalDockerError as exc:
                errors["local"] = str(exc)

        if source_filter in ("", "nexus"):
            try:
                # 跨全部 docker 仓库搜索，最多翻 10 页防止结果过大
                token = ""
                for _ in range(10):
                    result = NexusService.search_docker_images(keyword=keyword, continuation_token=token)
                    for item in result["items"]:
                        items.append({**item, "source": "nexus"})
                    token = result["continuation_token"]
                    if not token:
                        break
            except NexusError as exc:
                errors["nexus"] = str(exc)

        return success_response({"items": items, "errors": errors})


class PackageNodeViewSet(StandardModelViewSet):
    """远程打包节点视图集（系统级节点池）。"""

    queryset = PackageNode.objects.select_related("credential", "created_by").all()
    serializer_class = PackageNodeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["os_type", "is_active"]
    search_fields = ["name", "host"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_permissions(self):
        # 节点维护与连通性测试需要 system.package_image 权限（与打包镜像同级），超管自动放行
        if self.action in (
            "create", "update", "partial_update", "destroy", "test", "test_connection",
        ):
            return [IsAuthenticated(), HasPermission("system.package_image")]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        """节点仍被远程打包配置引用时禁止删除。"""
        node = self.get_object()
        if node.package_configs.filter(executor_type="remote_windows").exists():
            return error_response(
                40900,
                "节点仍被远程 Windows 打包配置引用，请先将相关配置改为本地 Docker 或删除配置",
                status_code=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="test")
    def test(self, request, pk=None):
        """测试已保存节点的 SSH 连通性（含系统信息、git 检测、工作目录创建）。"""
        node = self.get_object()
        if not node.credential_id:
            return error_response(40000, "节点未配置登录凭证", status_code=status.HTTP_400_BAD_REQUEST)
        try:
            result = test_node_connection(
                host=node.host,
                port=node.port,
                credential_id=str(node.credential_id),
                work_root=node.work_root,
            )
        except RemoteNodeError as exc:
            return error_response(50200, str(exc), status_code=status.HTTP_502_BAD_GATEWAY)
        message = "节点连接测试成功"
        if not result.get("git"):
            message += "（未检测到 git，打包时将无法拉取源码）"
        return success_response(result, message)

    @action(detail=False, methods=["post"], url_path="test-connection")
    def test_connection(self, request):
        """测试未保存的节点连接参数（host / port / credential_id / work_root）。"""
        data = request.data or {}
        host = (data.get("host") or "").strip()
        port = data.get("port") or 22
        credential_id = data.get("credential_id")
        work_root = (data.get("work_root") or "").strip()
        if not host:
            return error_response(40000, "请输入主机地址", status_code=status.HTTP_400_BAD_REQUEST)
        if not credential_id:
            return error_response(40000, "请选择登录凭证", status_code=status.HTTP_400_BAD_REQUEST)
        try:
            port = int(port)
        except (TypeError, ValueError):
            return error_response(40000, "端口号不合法", status_code=status.HTTP_400_BAD_REQUEST)
        try:
            result = test_node_connection(
                host=host, port=port, credential_id=str(credential_id), work_root=work_root,
            )
        except RemoteNodeError as exc:
            return error_response(50200, str(exc), status_code=status.HTTP_502_BAD_GATEWAY)
        message = "节点连接测试成功"
        if not result.get("git"):
            message += "（未检测到 git，打包时将无法拉取源码）"
        return success_response(result, message)


class PackageConfigViewSet(StandardModelViewSet):
    """项目级打包配置视图集。"""

    queryset = PackageConfig.objects.all()
    serializer_class = PackageConfigSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repository", "is_active", "auto_package_on_release"]
    search_fields = ["name", "repository__name"]
    ordering_fields = ["created_at", "updated_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return PackageConfig.objects.none()
        queryset = PackageConfig.objects.select_related("project", "repository", "image", "node", "svn_credential")
        if user.is_superuser:
            return queryset
        # 预取当前用户在每个项目中的成员记录，避免序列化器 get_my_role 在列表场景触发 N+1
        queryset = queryset.prefetch_related(
            Prefetch(
                "project__members",
                queryset=ProjectMember.objects.filter(user=user),
                to_attr="_my_member",
            )
        )
        project_ids = visible_project_ids(user)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            # 打包配置参数仅项目管理员 / 软件管理员可维护
            return [IsAuthenticated(), IsProjectPackageAdmin()]
        if self.action == "trigger":
            # 手动触发打包：管理员/开发/测试均可
            return [IsAuthenticated(), IsProjectPackager()]
        return [IsAuthenticated(), IsProjectMember()]

    @action(detail=True, methods=["post"], url_path="trigger")
    def trigger(self, request, pk=None):
        """手动触发某个已发布版本的打包。"""
        config = self.get_object()
        release_id = request.data.get("release") or request.data.get("release_id")
        if not release_id:
            return error_response(40000, "必须指定 release_id", status_code=status.HTTP_400_BAD_REQUEST)
        release = ReleaseRecord.objects.filter(id=release_id).select_related("project", "repository").first()
        if not release:
            return error_response(40400, "发布记录不存在", status_code=status.HTTP_404_NOT_FOUND)
        task = PackageService.create_task_for_release(config, release, request_user=request.user)
        data = PackageTaskSerializer(task, context={"request": request}).data
        return success_response(data, "已创建打包任务", status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="svn-entries")
    def svn_entries(self, request, pk=None):
        """实时浏览该配置 SVN 制品目录下的内容（svn list，不递归）。"""
        config = self.get_object()
        if not config.svn_push_enabled or not config.svn_url:
            return error_response(40000, "该配置未启用 SVN 推送", status_code=status.HTTP_400_BAD_REQUEST)
        if not config.svn_credential or not config.svn_credential.is_active:
            return error_response(40000, "SVN 凭证未配置或已停用", status_code=status.HTTP_400_BAD_REQUEST)

        # 相对子路径安全校验：拒绝 .. 与绝对路径，防止跳出 svn_url 根目录
        sub_path = request.query_params.get("path", "").strip("/")
        if sub_path and (sub_path.startswith("/") or any(part == ".." for part in sub_path.split("/"))):
            return error_response(40000, "非法的目录路径", status_code=status.HTTP_400_BAD_REQUEST)

        base_url = config.svn_url.rstrip("/")
        target_url = f"{base_url}/{sub_path}" if sub_path else base_url
        provider = get_provider("svn", base_url, config.svn_credential.get_data())
        try:
            entries = provider.list_dir(target_url)
        except ProviderError as exc:
            return error_response(50200, str(exc), status_code=status.HTTP_502_BAD_GATEWAY)
        return success_response({"base_url": base_url, "path": sub_path, "entries": entries})

    @action(detail=False, methods=["post"], url_path="test-svn")
    def test_svn(self, request):
        """
        测试 SVN 推送配置连通性

        支持未保存配置，通过 project_id / svn_url / svn_credential_id 临时验证。
        """
        data = request.data or {}
        project_id = data.get("project_id")
        svn_url = (data.get("svn_url") or "").strip()
        svn_credential_id = data.get("svn_credential_id")
        svn_path_template = (data.get("svn_path_template") or "").strip()

        if not project_id:
            return error_response(40000, "必须指定项目", status_code=status.HTTP_400_BAD_REQUEST)
        if not svn_url:
            return error_response(40000, "请输入 SVN 仓库地址", status_code=status.HTTP_400_BAD_REQUEST)
        if not svn_credential_id:
            return error_response(40000, "请选择 SVN 凭证", status_code=status.HTTP_400_BAD_REQUEST)
        if not (
            svn_url.startswith("svn://")
            or svn_url.startswith("http://")
            or svn_url.startswith("https://")
        ):
            return error_response(40000, "SVN 仓库地址必须以 svn://、http:// 或 https:// 开头", status_code=status.HTTP_400_BAD_REQUEST)

        try:
            project = Project.objects.get(id=project_id)
        except Project.DoesNotExist:
            return error_response(40400, "项目不存在", status_code=status.HTTP_404_NOT_FOUND)

        user = request.user
        if not user.is_superuser:
            is_manager = ProjectMember.objects.filter(
                project=project, user=user, role="manager"
            ).exists()
            is_leader = str(project.leader_id) == str(user.id)
            if not is_manager and not is_leader:
                return error_response(
                    40300, "只有项目管理员可测试 SVN 配置", status_code=status.HTTP_403_FORBIDDEN
                )

        try:
            credential = Credential.objects.get(
                id=svn_credential_id, is_active=True, cred_type="svn_password"
            )
        except Credential.DoesNotExist:
            return error_response(40000, "SVN 凭证不存在或已停用", status_code=status.HTTP_400_BAD_REQUEST)

        target_url = svn_url.rstrip("/")
        if svn_path_template and "{" not in svn_path_template and "}" not in svn_path_template:
            target_url = f"{target_url}/{svn_path_template.strip('/')}"

        provider = get_provider("svn", target_url, credential.get_data())
        try:
            entries = provider.list_dir(target_url)
        except AuthenticationError as exc:
            return error_response(40100, f"SVN 账号或密码错误: {exc}", status_code=status.HTTP_401_UNAUTHORIZED)
        except NotFoundError as exc:
            return error_response(40400, f"SVN 路径不存在: {exc}", status_code=status.HTTP_404_NOT_FOUND)
        except ConnectionError as exc:
            return error_response(50200, f"无法连接 SVN 服务器: {exc}", status_code=status.HTTP_502_BAD_GATEWAY)
        except ProviderError as exc:
            return error_response(50000, f"SVN 测试失败: {exc}", status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return success_response(
            {"ok": True, "entries": entries, "message": "连接成功"},
            message="SVN 连接测试成功",
        )


class PackageTaskViewSet(StandardReadOnlyModelViewSet):
    """打包任务只读视图集。"""

    queryset = PackageTask.objects.all()
    serializer_class = PackageTaskSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repository", "release", "config", "status", "build_type"]
    search_fields = ["name", "version", "tag_name", "project__name", "repository__name"]
    ordering_fields = ["created_at", "started_at", "finished_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return PackageTask.objects.none()
        queryset = PackageTask.objects.select_related("config", "release", "project", "repository", "triggered_by")
        if user.is_superuser:
            return queryset
        project_ids = visible_project_ids(user)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        if self.action in ("cancel", "push_svn"):
            # 取消任务 / 手动推 SVN：管理员/开发可操作
            return [IsAuthenticated(), IsProjectDeveloper()]
        return [IsAuthenticated(), IsProjectMember()]

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        """取消排队中或进行中的打包任务。"""
        task = self.get_object()
        if task.is_finished:
            return error_response(40000, "任务已结束，无法取消", status_code=status.HTTP_400_BAD_REQUEST)
        PackageService.cancel_task(task)
        data = PackageTaskSerializer(task, context={"request": request}).data
        return success_response(data, "任务已取消")

    @action(detail=True, methods=["post"], url_path="push-svn")
    def push_svn(self, request, pk=None):
        """手动推送打包产物到 SVN。"""
        task = self.get_object()
        try:
            result = PackageService.manual_push_svn(task)
        except serializers.ValidationError as exc:
            return error_response(40000, str(exc.detail[0] if isinstance(exc.detail, list) else exc.detail),
                                  status_code=status.HTTP_400_BAD_REQUEST)
        except RuntimeError as exc:
            return error_response(50000, str(exc), status_code=status.HTTP_400_BAD_REQUEST)
        data = PackageTaskSerializer(task, context={"request": request}).data
        return success_response(data, f"已推送到 {result['remote_url']}")

    @action(detail=True, methods=["get"], url_path="logs")
    def logs(self, request, pk=None):
        """读取任务日志。

        默认返回完整文本（兼容旧调用）。
        增量模式（大日志优化）：
        - ``?tail=<bytes>``：只返回文件末尾 tail 字节，用于首屏快速打开；
        - ``?offset=<bytes>``：返回该偏移之后的新增内容，用于轮询追加；
        两种模式均返回 JSON ``{size, offset, content}``，offset 为本次内容的
        起始字节位置（下次轮询传 size 即可只取增量）；日志文件被截断
        （offset > size）时回退返回全量并带 ``truncated: true``。
        """
        task = self.get_object()
        tail = request.query_params.get("tail")
        offset = request.query_params.get("offset")
        incremental = tail is not None or offset is not None

        if not task.log_path or not Path(task.log_path).exists():
            if incremental:
                return success_response({"size": 0, "offset": 0, "content": ""})
            return HttpResponse("", content_type="text/plain; charset=utf-8")
        workspace = Path(task.workspace_path).resolve() if task.workspace_path else None
        log_path = Path(task.log_path).resolve()
        workspace_root = PackageService.workspace_root().resolve()
        if (
            not workspace
            or (workspace != workspace_root and workspace_root not in workspace.parents)
            or (workspace not in log_path.parents and log_path != workspace)
        ):
            raise Http404("日志路径非法")

        if not incremental:
            return FileResponse(open(log_path, "rb"), content_type="text/plain; charset=utf-8")

        size = log_path.stat().st_size
        start = 0
        truncated = False
        if offset is not None:
            try:
                start = max(0, int(offset))
            except (TypeError, ValueError):
                return error_response(40000, "offset 参数不合法", status_code=status.HTTP_400_BAD_REQUEST)
            if start > size:
                # 日志被截断/重建，回退全量
                start = 0
                truncated = True
        elif tail is not None:
            try:
                tail_bytes = max(1, min(int(tail), 10 * 1024 * 1024))
            except (TypeError, ValueError):
                return error_response(40000, "tail 参数不合法", status_code=status.HTTP_400_BAD_REQUEST)
            start = max(0, size - tail_bytes)

        with open(log_path, "rb") as f:
            f.seek(start)
            # UTF-8 多字节字符可能在 seek 边界截断，容错解码
            content = f.read().decode("utf-8", errors="replace")
        return success_response({
            "size": size,
            "offset": start,
            "content": content,
            "truncated": truncated,
        })

    @action(detail=True, methods=["get"], url_path=r"artifacts/(?P<artifact_id>[^/.]+)/download")
    def download_artifact(self, request, pk=None, artifact_id=None):
        """下载任务产物。"""
        task = self.get_object()
        artifact = next((item for item in task.artifact_info if item.get("id") == artifact_id), None)
        if not artifact:
            raise Http404("产物不存在")
        workspace = Path(task.workspace_path).resolve() if task.workspace_path else None
        workspace_root = PackageService.workspace_root().resolve()
        if not workspace or (workspace != workspace_root and workspace_root not in workspace.parents):
            raise Http404("工作区路径非法")
        root = workspace / "artifacts"
        file_path = (root / artifact["path"]).resolve()
        if root.resolve() not in file_path.parents and file_path != root.resolve():
            raise Http404("产物路径非法")
        if not file_path.exists() or not file_path.is_file():
            raise Http404("产物文件不存在")
        return FileResponse(open(file_path, "rb"), as_attachment=True, filename=artifact.get("name") or file_path.name)

    @action(detail=True, methods=["get"], url_path="download-all")
    def download_all(self, request, pk=None):
        """将任务全部产物打包为 zip 一键下载。"""
        task = self.get_object()
        workspace = Path(task.workspace_path).resolve() if task.workspace_path else None
        workspace_root = PackageService.workspace_root().resolve()
        if not workspace or (workspace != workspace_root and workspace_root not in workspace.parents):
            raise Http404("工作区路径非法")

        artifacts = task.artifact_info or []
        if not artifacts:
            raise Http404("没有可下载产物")

        root = workspace / "artifacts"
        if not root.exists() or not root.is_dir():
            raise Http404("产物目录不存在")

        fd, zip_path = tempfile.mkstemp(suffix=".zip", prefix=f"task_{task.id}_")
        os.close(fd)
        try:
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for artifact in artifacts:
                    rel_path = (artifact.get("path") or "").strip().replace("\\", "/")
                    if not rel_path or any(part == ".." for part in rel_path.split("/")):
                        continue
                    file_path = (root / rel_path).resolve()
                    if root.resolve() not in file_path.parents and file_path != root.resolve():
                        continue
                    if not file_path.exists() or not file_path.is_file():
                        continue
                    zf.write(file_path, rel_path)
            if os.path.getsize(zip_path) == 0:
                os.remove(zip_path)
                raise Http404("没有可下载的有效产物文件")
            safe_name = str(task.name).replace(" ", "_").replace("/", "_") or "artifacts"
            filename = f"{safe_name}-{task.version}-artifacts.zip"
            return _TempFileResponse(zip_path, as_attachment=True, filename=filename)
        except Exception:
            if os.path.exists(zip_path):
                os.remove(zip_path)
            raise
