"""打包配置收藏与任务统计接口测试。"""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageConfigFavorite, PackageImage, PackageTask
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository


@pytest.fixture
def user():
    return User.objects.create_user(
        username="fav_user",
        password="pass",
        nickname="收藏用户",
    )


@pytest.fixture
def other_user():
    return User.objects.create_user(
        username="fav_other_user",
        password="pass",
        nickname="其他用户",
    )


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    project = Project.objects.create(
        name="收藏测试项目",
        code="FAVT",
        leader=user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=user, role="software_admin")
    return project


@pytest.fixture
def repository(project):
    from apps.project.services import ensure_repository_component

    repo = Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="web",
        url="https://gitlab.example.com",
        external_identity="group/web",
        default_branch="main",
        created_by=project.leader,
    )
    ensure_repository_component(repo, project)
    return repo


@pytest.fixture
def package_config(project, repository):
    image = PackageImage.objects.create(
        name="Web 镜像",
        image="trace-ship/web:latest",
    )
    return PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="Web 打包",
        image=image,
    )


def _make_task(package_config, project, repository, user, **kwargs) -> PackageTask:
    defaults = {
        "config": package_config,
        "project": project,
        "repository": repository,
        "triggered_by": user,
        "name": "Web 打包 / V1.0.0",
        "tag_name": "V1.0.0",
        "version": "V1.0.0",
        "status": "success",
    }
    defaults.update(kwargs)
    return PackageTask.objects.create(**defaults)


@pytest.mark.django_db
class TestConfigFavorite:
    """POST /api/packages/configs/{id}/favorite/ 切换收藏。"""

    def test_toggle_roundtrip(self, api_client, user, package_config):
        url = f"/api/packages/configs/{package_config.id}/favorite/"
        resp = api_client.post(url)
        assert resp.status_code == 200
        assert resp.data["data"]["is_favorite"] is True
        assert PackageConfigFavorite.objects.filter(user=user, config=package_config).exists()

        # 再次调用即取消收藏（toggle 语义，不报错）
        resp = api_client.post(url)
        assert resp.status_code == 200
        assert resp.data["data"]["is_favorite"] is False
        assert not PackageConfigFavorite.objects.filter(user=user, config=package_config).exists()

    def test_repeat_favorite_no_error(self, api_client, user, package_config):
        """连续调用 toggle 不会产生重复记录或报错。"""
        url = f"/api/packages/configs/{package_config.id}/favorite/"
        api_client.post(url)
        api_client.post(url)
        resp = api_client.post(url)
        assert resp.status_code == 200
        assert resp.data["data"]["is_favorite"] is True
        assert PackageConfigFavorite.objects.filter(user=user, config=package_config).count() == 1

    def test_non_member_forbidden(self, other_user, package_config):
        client = APIClient()
        client.force_authenticate(user=other_user)
        resp = client.post(f"/api/packages/configs/{package_config.id}/favorite/")
        # 非项目成员的配置不在可见 queryset 内，对象不存在即 404
        assert resp.status_code == 404


@pytest.mark.django_db
class TestFavoriteList:
    """GET /api/packages/configs/favorites/ 收藏列表。"""

    def test_only_own_favorites(self, api_client, user, other_user, package_config):
        PackageConfigFavorite.objects.create(user=other_user, config=package_config)
        resp = api_client.get("/api/packages/configs/favorites/")
        assert resp.status_code == 200
        assert resp.data["data"] == []

        PackageConfigFavorite.objects.create(user=user, config=package_config)
        resp = api_client.get("/api/packages/configs/favorites/")
        assert resp.status_code == 200
        data = resp.data["data"]
        assert len(data) == 1
        item = data[0]
        assert item["id"] == str(package_config.id)
        assert item["name"] == package_config.name
        assert item["project_name"] == "收藏测试项目"
        assert item["repository_name"] == "web"
        assert item["image_name"] == "Web 镜像"
        assert item["executor_type"] == "local_docker"
        assert item["last_task"] is None

    def test_last_task_is_latest(self, api_client, user, package_config, project, repository):
        old_task = _make_task(package_config, project, repository, user, version="V0.9.0", status="failure")
        PackageTask.objects.filter(id=old_task.id).update(
            created_at=timezone.now() - timedelta(days=1)
        )
        latest_task = _make_task(
            package_config, project, repository, user,
            version="V1.0.0", status="success", duration=65000,
            finished_at=timezone.now(),
        )
        PackageConfigFavorite.objects.create(user=user, config=package_config)

        resp = api_client.get("/api/packages/configs/favorites/")
        assert resp.status_code == 200
        item = resp.data["data"][0]
        assert item["last_task"]["id"] == str(latest_task.id)
        assert item["last_task"]["status"] == "success"
        assert item["last_task"]["status_display"] == "成功"
        assert item["last_task"]["version"] == "V1.0.0"
        assert item["last_task"]["duration"] == 65000
        assert item["last_task"]["finished_at"] is not None

    def test_no_task_last_task_null(self, api_client, user, package_config):
        PackageConfigFavorite.objects.create(user=user, config=package_config)
        resp = api_client.get("/api/packages/configs/favorites/")
        assert resp.status_code == 200
        assert resp.data["data"][0]["last_task"] is None

    def test_config_deleted_cascades(self, api_client, user, package_config):
        PackageConfigFavorite.objects.create(user=user, config=package_config)
        package_config.delete()
        resp = api_client.get("/api/packages/configs/favorites/")
        assert resp.status_code == 200
        assert resp.data["data"] == []

    def test_is_favorite_in_config_list(self, api_client, user, package_config, project, repository):
        image = PackageImage.objects.create(
            name="Qt 镜像", image_name="trace-ship/qt", image_tag="latest",
        )
        other_config = PackageConfig.objects.create(
            project=project, repository=repository, name="Qt 打包", image=image,
        )
        PackageConfigFavorite.objects.create(user=user, config=package_config)

        resp = api_client.get("/api/packages/configs/")
        assert resp.status_code == 200
        results = {item["id"]: item for item in resp.data["data"]["results"]}
        assert results[str(package_config.id)]["is_favorite"] is True
        assert results[str(other_config.id)]["is_favorite"] is False

    def test_favorites_not_filtered_by_membership(self, api_client, user, package_config, project):
        """ADR-0019：收藏即个人入口授权——被移出项目后 favorites 仍返回该配置。"""
        PackageConfigFavorite.objects.create(user=user, config=package_config)
        ProjectMember.objects.filter(project=project, user=user).delete()

        resp = api_client.get("/api/packages/configs/favorites/")
        assert resp.status_code == 200
        ids = [item["id"] for item in resp.data["data"]]
        assert str(package_config.id) in ids

    def test_favorites_sorted_first_in_config_list(self, api_client, user, package_config, project, repository):
        """配置列表默认收藏优先：收藏的配置排最前，显式 ordering 参数时不强制。"""
        image = PackageImage.objects.create(
            name="Qt 镜像", image_name="trace-ship/qt", image_tag="latest",
        )
        other_config = PackageConfig.objects.create(
            project=project, repository=repository, name="Qt 打包", image=image,
        )
        PackageConfigFavorite.objects.create(user=user, config=other_config)

        resp = api_client.get("/api/packages/configs/")
        assert resp.status_code == 200
        ids = [item["id"] for item in resp.data["data"]["results"]]
        assert ids[0] == str(other_config.id)
        # 显式排序参数优先于默认收藏排序
        resp = api_client.get("/api/packages/configs/?ordering=created_at")
        ids = [item["id"] for item in resp.data["data"]["results"]]
        assert ids[0] == str(package_config.id)


@pytest.mark.django_db
class TestTaskStats:
    """GET /api/packages/tasks/stats/ 我发起的任务统计。"""

    def test_only_own_tasks(self, api_client, user, other_user, package_config, project, repository):
        _make_task(package_config, project, repository, other_user, status="success")
        resp = api_client.get("/api/packages/tasks/stats/")
        assert resp.status_code == 200
        data = resp.data["data"]
        assert data["total"] == 0
        assert data["success"] == 0
        assert data["failure"] == 0
        assert data["canceled"] == 0
        assert data["success_rate"] == 0
        assert data["avg_duration_seconds"] == 0
        assert data["days"] == 30

    def test_superuser_only_own(self, user, other_user, package_config, project, repository):
        """ADR-0019：stats 口径固定为「我发起的」，超管也不放开。"""
        user.is_superuser = True
        user.save()
        _make_task(package_config, project, repository, other_user, status="success")
        _make_task(package_config, project, repository, user, status="failure")
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.get("/api/packages/tasks/stats/")
        data = resp.data["data"]
        assert data["total"] == 1
        assert data["failure"] == 1

    def test_excludes_unfinished(self, api_client, user, package_config, project, repository):
        _make_task(package_config, project, repository, user, status="queued")
        _make_task(package_config, project, repository, user, status="running")
        _make_task(package_config, project, repository, user, status="success")
        resp = api_client.get("/api/packages/tasks/stats/")
        data = resp.data["data"]
        assert data["total"] == 1
        assert data["success"] == 1

    def test_outside_window_excluded(self, api_client, user, package_config, project, repository):
        old_task = _make_task(package_config, project, repository, user, status="success")
        PackageTask.objects.filter(id=old_task.id).update(
            created_at=timezone.now() - timedelta(days=40)
        )
        _make_task(package_config, project, repository, user, status="failure")
        resp = api_client.get("/api/packages/tasks/stats/?days=30")
        data = resp.data["data"]
        assert data["total"] == 1
        assert data["failure"] == 1

        # 扩大窗口后旧任务计入
        resp = api_client.get("/api/packages/tasks/stats/?days=60")
        assert resp.data["data"]["total"] == 2
        assert resp.data["data"]["days"] == 60

    def test_invalid_days_fallback(self, api_client, user):
        for raw in ("0", "366", "abc"):
            resp = api_client.get(f"/api/packages/tasks/stats/?days={raw}")
            assert resp.status_code == 200
            assert resp.data["data"]["days"] == 30

    def test_rate_and_avg_duration(self, api_client, user, package_config, project, repository):
        _make_task(package_config, project, repository, user, status="success", duration=60000)
        _make_task(package_config, project, repository, user, status="success", duration=120000)
        _make_task(package_config, project, repository, user, status="failure", duration=0)
        _make_task(package_config, project, repository, user, status="canceled", duration=0)
        resp = api_client.get("/api/packages/tasks/stats/")
        data = resp.data["data"]
        assert data["total"] == 4
        assert data["success"] == 2
        assert data["failure"] == 1
        assert data["canceled"] == 1
        assert data["success_rate"] == 50.0
        # 仅统计有耗时的任务：(60000 + 120000) / 2 = 90000ms = 90 秒
        assert data["avg_duration_seconds"] == 90

    def test_empty_all_zero(self, api_client, user):
        resp = api_client.get("/api/packages/tasks/stats/")
        assert resp.status_code == 200
        assert resp.data["data"] == {
            "days": 30,
            "total": 0,
            "success": 0,
            "failure": 0,
            "canceled": 0,
            "success_rate": 0,
            "avg_duration_seconds": 0,
        }


@pytest.mark.django_db
class TestTaskSearch:
    """任务搜索补充：按配置名与触发人昵称命中。"""

    def test_search_by_config_name(self, api_client, user, package_config, project, repository):
        _make_task(package_config, project, repository, user, name="任务甲", version="V1.0.0", tag_name="V1.0.0")
        _make_task(package_config, project, repository, user, name="任务乙", version="V2.0.0", tag_name="V2.0.0")
        resp = api_client.get("/api/packages/tasks/", {"search": "Web 打包"})
        assert resp.status_code == 200
        assert resp.data["data"]["total"] == 2

        image = PackageImage.objects.create(
            name="Qt 镜像", image_name="trace-ship/qt", image_tag="latest",
        )
        qt_config = PackageConfig.objects.create(
            project=project, repository=repository, name="Qt 打包", image=image,
        )
        _make_task(qt_config, project, repository, user, name="任务丙", version="V3.0.0", tag_name="V3.0.0")
        resp = api_client.get("/api/packages/tasks/", {"search": "Qt 打包"})
        names = [item["name"] for item in resp.data["data"]["results"]]
        assert names == ["任务丙"]

    def test_search_by_triggered_by_nickname(self, api_client, user, other_user, package_config, project, repository):
        _make_task(package_config, project, repository, user, name="任务甲", version="V1.0.0", tag_name="V1.0.0")
        ProjectMember.objects.create(project=project, user=other_user, role="developer")
        _make_task(package_config, project, repository, other_user, name="任务乙", version="V2.0.0", tag_name="V2.0.0")

        resp = api_client.get("/api/packages/tasks/", {"search": "收藏用户"})
        names = [item["name"] for item in resp.data["data"]["results"]]
        assert names == ["任务甲"]

        resp = api_client.get("/api/packages/tasks/", {"search": "其他用户"})
        names = [item["name"] for item in resp.data["data"]["results"]]
        assert names == ["任务乙"]
