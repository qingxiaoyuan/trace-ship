"""通过 REST API 验证工作台布局、可见范围与发布阅读契约。"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.project.models import Project, ProjectComponent, ProjectMember
from apps.release.models import ReleaseRecord

pytestmark = pytest.mark.django_db


def test_maintainer_context_uses_all_visible_projects(user):
    """即使项目超过一页，布局与数量仍基于完整成员集合。"""
    for index in range(25):
        project = Project.objects.create(code=f"MNT-{index}", name=f"维保项目{index}")
        ProjectMember.objects.create(project=project, user=user, role="maintainer")
    Project.objects.create(code="HIDDEN", name="非所属项目")
    client = APIClient()
    client.force_authenticate(user)

    response = client.get("/api/releases/dashboard/context/", {"page_size": 1})

    assert response.status_code == 200
    assert response.data["data"] == {"layout_mode": "maintainer", "visible_project_count": 25}


@pytest.mark.parametrize("role,leader,superuser", [
    ("developer", False, False), ("tester", False, False),
    ("manager", False, False), ("software_admin", False, False),
    ("maintainer", True, False), ("maintainer", False, True),
])
def test_effective_roles_keep_general_dashboard(user, role, leader, superuser):
    """兼任、有效管理角色及超管继续使用通用工作台。"""
    first = Project.objects.create(code="FIRST", name="维保项目")
    ProjectMember.objects.create(project=first, user=user, role="maintainer")
    other = Project.objects.create(code="OTHER", name="另一项目", leader=user if leader else None)
    ProjectMember.objects.create(project=other, user=user, role=role)
    user.is_superuser = superuser
    user.save()
    client = APIClient()
    client.force_authenticate(user)
    assert client.get("/api/releases/dashboard/context/").data["data"] == {
        "layout_mode": "general", "visible_project_count": 2,
    }


def test_context_refreshes_after_membership_changes(user):
    """无项目、加入维保、兼任、移除兼任后，下一次读取立刻反映变化。"""
    client = APIClient()
    client.force_authenticate(user)
    url = "/api/releases/dashboard/context/"
    # 负责人身份本身不能扩大显式成员可见范围。
    Project.objects.create(code="LEADER-ONLY", name="未加入的项目", leader=user)
    assert client.get(url).data["data"] == {"layout_mode": "general", "visible_project_count": 0}
    project = Project.objects.create(code="JOINED", name="加入的项目")
    member = ProjectMember.objects.create(project=project, user=user, role="maintainer")
    assert client.get(url).data["data"]["layout_mode"] == "maintainer"
    member.role = "developer"
    member.save()
    assert client.get(url).data["data"]["layout_mode"] == "general"
    member.delete()
    assert client.get(url).data["data"] == {"layout_mode": "general", "visible_project_count": 0}


def test_context_requires_authentication():
    assert APIClient().get("/api/releases/dashboard/context/").status_code == 401


def test_released_list_is_paginated_by_actual_time_and_project(user, project, repository):
    """他人发布可见、共享仓库隔离；缺失发布时间排后且不以创建时间冒充。"""
    from apps.account.models import User

    maintainer = User.objects.create_user(username="maintainer")
    ProjectMember.objects.create(project=project, user=maintainer, role="maintainer")
    component = ProjectComponent.objects.get(project=project, repository=repository)
    component.display_name = "项目内软件名称"
    component.save()
    hidden = Project.objects.create(code="SECRET", name="非所属项目")
    ProjectComponent.objects.create(project=hidden, repository=repository, component_code="shared")
    now = timezone.now()
    rows = []
    for index, (target, status, released_at) in enumerate([
        (project, "released", None),
        (project, "released", now - timedelta(days=1)),
        (project, "released", now),
        (project, "draft", None),
        (hidden, "released", now + timedelta(days=1)),
    ]):
        rows.append(ReleaseRecord.objects.create(
            project=target, repository=repository, publisher=user,
            version=f"V1.0.{index}", tag_name=f"v1.0.{index}",
            status=status, released_at=released_at,
        ))
    client = APIClient()
    client.force_authenticate(maintainer)
    params = {"status": "released", "ordering": "-released_at", "page_size": 2}
    first = client.get("/api/releases/", params).data["data"]
    second = client.get("/api/releases/", {**params, "page": 2}).data["data"]
    assert first["total"] == 3
    assert [row["id"] for row in first["results"]] == [str(rows[2].id), str(rows[1].id)]
    assert first["results"][0]["component_name"] == "项目内软件名称"
    assert second["results"][0]["id"] == str(rows[0].id)
    assert second["results"][0]["released_at"] is None
    assert client.get("/api/releases/", {**params, "project": str(hidden.id)}).data["data"]["total"] == 0
    assert client.get(f"/api/releases/{rows[2].id}/").status_code == 200
    assert client.get(f"/api/releases/{rows[4].id}/").status_code == 404


def test_maintainer_summary_uses_visible_projects_and_real_windows(user, project, repository):
    """指标聚合全量所属项目；取消进入成功率分母，失败不限时间且包含他人。"""
    from apps.account.models import User
    from apps.package.models import PackageTask

    reader = User.objects.create_user(username="summary-reader")
    ProjectMember.objects.create(project=project, user=reader, role="maintainer")
    hidden = Project.objects.create(code="INVISIBLE", name="不可见项目")
    now = timezone.now()
    for index, (target, status, when) in enumerate([
        (project, "released", now), (project, "released", now - timedelta(days=31)),
        (project, "released", None), (project, "draft", now), (hidden, "released", now),
    ]):
        ReleaseRecord.objects.create(project=target, repository=repository, publisher=user,
                                    version=f"V2.{index}.0", status=status, released_at=when)
    tasks = []
    for index, (target, status, days) in enumerate([
        (project, "success", 0), (project, "failure", 0), (project, "canceled", 0),
        (project, "running", 0), (project, "failure", 40), (hidden, "success", 0),
    ]):
        task = PackageTask.objects.create(project=target, repository=repository, triggered_by=user,
                                          name=f"任务{index}", version="V1", status=status)
        PackageTask.objects.filter(pk=task.pk).update(created_at=now - timedelta(days=days))
        tasks.append(task)
    client = APIClient()
    client.force_authenticate(reader)
    response = client.get("/api/releases/dashboard/maintainer-summary/", {"project": str(hidden.id), "search": "不存在"})
    assert response.status_code == 200
    data = response.data["data"]
    assert data["stats"]["released_count"] == 1
    assert data["stats"]["failed_task_count"] == 2
    assert data["stats"]["package_total"] == 3
    assert data["stats"]["package_success"] == 1
    assert data["stats"]["package_success_rate"] == 33.3
    assert [item["id"] for item in data["projects"]] == [str(project.id)]
    assert data["software_count"] == 1
    assert all(item["project"] == str(project.id) for item in data["recent_tasks"])
    assert str(tasks[-1].id) not in {item["id"] for item in data["recent_tasks"]}
    assert APIClient().get("/api/releases/dashboard/maintainer-summary/").status_code == 401


def test_release_search_summary_and_latest_config_results(user, project, repository):
    """全文及组件名称在服务端搜索；一份配置成功不会掩盖另一份配置的失败。"""
    from apps.package.models import PackageConfig, PackageTask

    component = ProjectComponent.objects.get(project=project, repository=repository)
    component.display_name = "park-server"
    component.save()
    release = ReleaseRecord.objects.create(project=project, repository=repository, publisher=user,
        version="VA.5.2.0", status="released", release_type="formal",
        release_doc="| 字段 | 内容 |\n| --- | --- |\n| 更新内容 | 新增访客预约，优化车辆通行记录查询<br>修复数据异常 |")
    for index, status in enumerate(["failure", "success"]):
        config = PackageConfig.objects.create(project_component=component, name=f"配置{index}")
        PackageTask.objects.create(config=config, release=release, project=project, repository=repository,
                                  version=release.version, status=status)
    client = APIClient()
    client.force_authenticate(user)
    for keyword in ["park-server", "访客预约", "VA.5.2"]:
        data = client.get("/api/releases/", {"status": "released", "search": keyword,
            "project": str(project.id), "repository": str(repository.id), "release_type": "formal"}).data["data"]
        assert data["total"] == 1
        assert "新增访客预约" in data["results"][0]["update_summary"]
        assert "<br>" not in data["results"][0]["update_summary"]
        summary = data["results"][0]["package_summary"]
        assert summary["status"] == "failure"
        assert summary["counts"] == {"failure": 1, "success": 1}


def test_maintainer_summary_without_package_samples(user):
    client = APIClient()
    client.force_authenticate(user)
    data = client.get("/api/releases/dashboard/maintainer-summary/").data["data"]
    assert data["stats"]["package_total"] == 0
    assert data["stats"]["package_success_rate"] is None
    assert data["recent_tasks"] == []


@pytest.mark.parametrize("content", ["A 新增访客预约\nF 修复数据同步", "\nA 新增访客预约\nF 修复数据同步"])
def test_release_summary_preserves_multiline_table_updates(user, project, repository, content):
    """发布生成器及人工编辑保留的单元格换行，不能丢失第二条更新。"""
    ReleaseRecord.objects.create(project=project, repository=repository, publisher=user,
        version="VA.9.0.0", status="released", release_type="formal",
        release_doc=f"| 项目 | 内容 |\n| --- | --- |\n| 变更内容 | {content} |\n| 测试验证 | 无关字段 |")
    client = APIClient()
    client.force_authenticate(user)
    summary = client.get("/api/releases/").data["data"]["results"][0]["update_summary"]
    assert "新增访客预约" in summary and "修复数据同步" in summary
    assert "无关字段" not in summary


def test_deleted_config_keeps_latest_result_grouped_by_snapshot(user, project, repository):
    """删除配置的 SET_NULL 不会让同配置的旧失败重新成为另一份配置。"""
    from apps.package.models import PackageConfig, PackageTask

    component = ProjectComponent.objects.get(project=project, repository=repository)
    config = PackageConfig.objects.create(project_component=component, name="可删除配置")
    release = ReleaseRecord.objects.create(project=project, repository=repository, publisher=user,
                                          version="VA.3.0.0", status="released", release_type="formal")
    for index, status in enumerate(["failure", "success"]):
        task = PackageTask.objects.create(config=config, release=release, project=project, repository=repository,
                                         version=release.version, status=status, config_snapshot={"config_id": str(config.id)})
        PackageTask.objects.filter(pk=task.pk).update(created_at=timezone.now() + timedelta(seconds=index))
    config.delete()
    client = APIClient()
    client.force_authenticate(user)
    result = client.get("/api/releases/").data["data"]["results"][0]["package_summary"]
    assert result["status"] == "success"
    assert result["config_count"] == 1
