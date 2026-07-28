"""
打包镜像配置测试（本地 / Nexus）
"""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.docker_local import LocalDockerError
from apps.package.models import PackageImage
from apps.package.nexus import NexusService
from apps.package.serializers import PackageConfigSerializer, PackageImageSerializer
from apps.system.models import SystemConfig


@pytest.fixture
def api_client(db):
    """已认证测试客户端。"""
    user = User.objects.create_user(username="image_user", password="pass", nickname="镜像用户")
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def admin_client(db):
    """超管测试客户端。"""
    admin = User.objects.create_superuser(username="image_admin", password="pass", nickname="超管")
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.mark.django_db
class TestPackageImageModel:
    """PackageImage 模型测试"""

    def test_nexus_image_full_path_with_repository(self):
        image = PackageImage.objects.create(
            name="Web 构建镜像",
            source="nexus",
            registry_host="nexus.example.com:8082",
            repository="docker-hosted",
            image_name="web-builder",
            image_tag="node22",
        )
        assert image.image == "nexus.example.com:8082/docker-hosted/web-builder:node22"

    def test_nexus_image_full_path_without_repository(self):
        image = PackageImage.objects.create(
            name="Web 构建镜像",
            source="nexus",
            registry_host="nexus.example.com:8082",
            repository="",
            image_name="web-builder",
            image_tag="node22",
        )
        assert image.image == "nexus.example.com:8082/web-builder:node22"

    def test_nexus_image_uses_default_registry_host(self, settings):
        settings.NEXUS_REGISTRY_HOST = "nexus.example.com:8082"
        image = PackageImage.objects.create(
            name="Web 构建镜像",
            source="nexus",
            registry_host="",
            repository="docker-hosted",
            image_name="web-builder",
            image_tag="node22",
        )
        assert image.image == "nexus.example.com:8082/docker-hosted/web-builder:node22"

    def test_local_image_uses_plain_name_tag(self):
        """本地镜像不带 registry 前缀，坐标字段统一清空。"""
        image = PackageImage.objects.create(
            name="本地构建镜像",
            source="local",
            registry_host="ignored:5000",
            repository="ignored",
            image_name="trace-ship/builder",
            image_tag="v1",
        )
        assert image.image == "trace-ship/builder:v1"
        assert image.registry_host == ""
        assert image.repository == ""


@pytest.mark.django_db
class TestPackageImageSerializer:
    """PackageImageSerializer 校验测试"""

    def test_source_must_be_nexus(self):
        serializer = PackageImageSerializer(data={
            "name": "测试",
            "source": "docker_hub",
            "image_name": "web-builder",
            "image_tag": "node22",
        })
        assert not serializer.is_valid()
        assert "source" in serializer.errors

    def test_image_name_required(self):
        serializer = PackageImageSerializer(data={
            "name": "测试",
            "source": "nexus",
            "image_tag": "node22",
        })
        assert not serializer.is_valid()
        assert "image_name" in serializer.errors

    def test_image_tag_required(self):
        serializer = PackageImageSerializer(data={
            "name": "测试",
            "source": "nexus",
            "image_name": "web-builder",
        })
        assert not serializer.is_valid()
        assert "image_tag" in serializer.errors

    def test_valid_nexus_image(self):
        serializer = PackageImageSerializer(data={
            "name": "测试",
            "source": "nexus",
            "registry_host": "nexus.example.com:8082",
            "repository": "docker-hosted",
            "image_name": "web-builder",
            "image_tag": "node22",
        })
        assert serializer.is_valid(), serializer.errors
        image = serializer.save()
        assert image.image == "nexus.example.com:8082/docker-hosted/web-builder:node22"


@pytest.mark.django_db
class TestResolveImageInfo:
    """打包配置按镜像坐标 get_or_create 镜像记录。"""

    def test_resolve_creates_local_image(self):
        image = PackageConfigSerializer._resolve_image_info({
            "source": "local",
            "image_name": "trace-ship/builder",
            "image_tag": "v1",
        })
        assert image.source == "local"
        assert image.image == "trace-ship/builder:v1"
        assert image.name == "trace-ship/builder:v1"

    def test_resolve_is_idempotent(self):
        info = {"source": "local", "image_name": "trace-ship/builder", "image_tag": "v1"}
        first = PackageConfigSerializer._resolve_image_info(info)
        second = PackageConfigSerializer._resolve_image_info(info)
        assert first.id == second.id
        assert PackageImage.objects.count() == 1

    def test_resolve_rejects_invalid_source(self):
        with pytest.raises(Exception):
            PackageConfigSerializer._resolve_image_info({
                "source": "dockerhub",
                "image_name": "x",
                "image_tag": "y",
            })


@pytest.mark.django_db
class TestAvailableImages:
    """available 接口聚合本地与 Nexus，单源失败不影响另一源。"""

    def test_available_aggregates_sources(self, api_client, monkeypatch):
        monkeypatch.setattr(
            "apps.package.views.LocalDockerService.list_images",
            classmethod(lambda cls, keyword="": [{
                "source": "local", "image": "builder:v1", "name": "builder",
                "version": "v1", "repository": "", "registry_host": "",
                "image_id": "abc", "size": "100MB",
            }]),
        )
        from apps.package.nexus import NexusError

        def fail_search(*args, **kwargs):
            raise NexusError("Nexus 不可用")

        monkeypatch.setattr("apps.package.views.NexusService.search_docker_images", fail_search)

        response = api_client.get("/api/packages/images/available/")
        assert response.status_code == 200
        payload = response.data["data"]
        assert len(payload["items"]) == 1
        assert payload["items"][0]["source"] == "local"
        assert payload["errors"]["nexus"] == "Nexus 不可用"

    def test_available_source_filter(self, api_client, monkeypatch):
        calls = []

        def fake_list(cls, keyword=""):
            calls.append("local")
            return []

        monkeypatch.setattr("apps.package.views.LocalDockerService.list_images", classmethod(fake_list))

        response = api_client.get("/api/packages/images/available/", {"source": "nexus"})
        assert response.status_code == 200
        assert calls == []
        assert "local" not in response.data["data"]["errors"]


@pytest.mark.django_db
class TestNexusConfigSource:
    """Nexus 连接配置：系统配置页面优先，环境变量兜底。"""

    def test_system_config_takes_precedence(self, settings):
        settings.NEXUS_BASE_URL = "http://env-nexus:8081"
        settings.NEXUS_REGISTRY_HOST = "env-registry:8082"
        SystemConfig.objects.create(key="nexus_base_url", value="http://db-nexus:8081")
        SystemConfig.objects.create(key="nexus_registry_host", value="db-registry:8082")

        cfg = NexusService._config()
        assert cfg["base_url"] == "http://db-nexus:8081"
        assert NexusService.registry_host() == "db-registry:8082"

    def test_env_fallback_when_no_system_config(self, settings):
        settings.NEXUS_BASE_URL = "http://env-nexus:8081"
        settings.NEXUS_REGISTRY_HOST = ""

        cfg = NexusService._config()
        assert cfg["base_url"] == "http://env-nexus:8081"
        assert NexusService.registry_host() == "env-nexus:8081"

    def test_partial_system_config_merges_with_env(self, settings):
        """系统配置只填了服务地址时，认证信息仍可走环境变量。"""
        settings.NEXUS_BASE_URL = ""
        settings.NEXUS_USERNAME = "env-user"
        settings.NEXUS_PASSWORD = "env-pass"
        SystemConfig.objects.create(key="nexus_base_url", value="http://db-nexus:8081")

        cfg = NexusService._config()
        assert cfg["base_url"] == "http://db-nexus:8081"
        assert cfg["username"] == "env-user"
        assert cfg["password"] == "env-pass"

    def test_base_url_auto_prefixes_scheme(self):
        """只填 host:port 时自动补 http 协议头。"""
        SystemConfig.objects.create(key="nexus_base_url", value="nexus.example.com:8081")
        assert NexusService._base_url(NexusService._config()) == "http://nexus.example.com:8081"


@pytest.mark.django_db
class TestImportImage:
    """上传 tar 包导入本地 Docker 镜像。"""

    def test_import_requires_superuser(self, api_client):
        file = SimpleUploadedFile("img.tar", b"fake-tar", content_type="application/x-tar")
        response = api_client.post("/api/packages/images/import/", {"file": file}, format="multipart")
        assert response.status_code == 403

    def test_import_missing_file(self, admin_client):
        response = admin_client.post("/api/packages/images/import/", {}, format="multipart")
        assert response.status_code == 400

    def test_import_rejects_bad_extension(self, admin_client):
        file = SimpleUploadedFile("img.zip", b"fake", content_type="application/zip")
        response = admin_client.post("/api/packages/images/import/", {"file": file}, format="multipart")
        assert response.status_code == 400

    def test_import_success(self, admin_client, monkeypatch):
        monkeypatch.setattr(
            "apps.package.views.LocalDockerService.load_image",
            classmethod(lambda cls, path: ["trace-ship/builder:v1"]),
        )
        file = SimpleUploadedFile("img.tar", b"fake-tar", content_type="application/x-tar")
        response = admin_client.post("/api/packages/images/import/", {"file": file}, format="multipart")
        assert response.status_code == 200
        assert response.data["data"]["loaded"] == ["trace-ship/builder:v1"]

    def test_import_docker_failure(self, admin_client, monkeypatch):
        def fail_load(cls, path):
            raise LocalDockerError("导入镜像失败：文件损坏")

        monkeypatch.setattr("apps.package.views.LocalDockerService.load_image", classmethod(fail_load))
        file = SimpleUploadedFile("img.tar", b"fake-tar", content_type="application/x-tar")
        response = admin_client.post("/api/packages/images/import/", {"file": file}, format="multipart")
        assert response.status_code == 500
