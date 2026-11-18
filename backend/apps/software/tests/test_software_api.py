"""软件登记与关联仓库的公开接口验收。"""

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.repository.models import Repository

pytestmark = pytest.mark.django_db


@pytest.fixture
def owner():
    return User.objects.create_user(username="software-owner", password="pass")


@pytest.fixture
def repository(owner):
    return Repository.objects.create(
        name="软件源码",
        vendor="gitlab",
        url="https://gitlab.example.com/team",
        external_identity="team/ship",
        created_by=owner,
    )


def authenticated(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def register(client, repository, slug, name):
    return client.post(
        "/api/software/",
        {"repository": str(repository.pk), "slug": slug, "name": name},
        format="json",
    )


def test_software_identity_is_unique_within_its_repository_and_survives_renaming(owner, repository):
    client = authenticated(owner)
    created = register(client, repository, "client-a", "客户端")
    assert created.status_code == 201, created.content
    saved = created.json()["data"]
    assert saved["owner"]["id"] == str(owner.pk)
    assert saved["repository"] == str(repository.pk)
    assert register(client, repository, "server-b", "服务端").status_code == 201
    assert register(client, repository, "client-a", "重复标识").status_code == 400
    assert register(client, repository, "client/child", "多级标识").status_code == 400

    other = Repository.objects.create(
        name="其他软件源码",
        vendor="gitlab",
        url="https://gitlab.example.com/other",
        external_identity="other/ship",
        created_by=owner,
    )
    assert register(client, other, "client-a", "其他仓库的客户端").status_code == 201

    detail_url = f"/api/software/{saved['id']}/"
    assert client.patch(detail_url, {"slug": "renamed", "name": "改名"}, format="json").status_code == 400
    assert client.patch(detail_url, {"repository": str(other.pk)}, format="json").status_code == 400
    assert client.patch(detail_url, {"name": "改名"}, format="json").status_code == 200
    renamed = client.get(detail_url).json()["data"]
    assert (renamed["id"], renamed["slug"], renamed["name"]) == (saved["id"], "client-a", "改名")
    deletion = client.delete(detail_url)
    assert deletion.status_code == 405, deletion.content


def test_software_permissions_follow_current_repository_owner(owner, repository):
    from apps.project.models import Project, ProjectComponent, ProjectMember
    from apps.software.models import Software, SoftwareMaintainer

    client = authenticated(owner)
    software_id = register(client, repository, "client-a", "客户端").json()["data"]["id"]
    software = Software.objects.get(pk=software_id)
    former_delegate = User.objects.create_user(username="former-delegate", password="pass")
    SoftwareMaintainer.objects.create(software=software, user=former_delegate)
    project = Project.objects.create(name="项目甲", code="LEFT")
    ProjectComponent.objects.create(project=project, repository=repository, component_code="repo")
    ProjectMember.objects.create(project=project, user=owner, role="developer")
    ProjectMember.objects.create(project=project, user=former_delegate, role="software_admin")

    url = f"/api/software/{software_id}/"
    delegate = authenticated(former_delegate)
    assert delegate.get(url).json()["data"]["can_maintain"] is False
    assert delegate.patch(url, {"name": "修改软件名称"}, format="json").status_code == 403
    assert client.post(url + "maintainers/", {"username": former_delegate.username}, format="json").status_code == 404
    assert client.patch(url, {"is_active": False}, format="json").status_code == 200
    assert authenticated(User.objects.create_superuser(username="software-superuser")).patch(
        url, {"is_active": True}, format="json",
    ).status_code == 200


def test_project_automatically_uses_all_enabled_repository_software(owner, repository):
    from apps.project.models import Project, ProjectComponent, ProjectMember
    from apps.software.models import ProjectSoftware

    manager = User.objects.create_user(username="software-manager", password="pass")
    reader = User.objects.create_user(username="project-maintainer", password="pass")
    left = Project.objects.create(name="项目甲", code="LEFT")
    right = Project.objects.create(name="项目乙", code="RIGHT")
    component = ProjectComponent.objects.create(project=left, repository=repository, component_code="software")
    ProjectComponent.objects.create(project=right, repository=repository, component_code="software")
    ProjectMember.objects.create(project=left, user=manager, role="software_admin")
    ProjectMember.objects.create(project=left, user=owner, role="developer")
    ProjectMember.objects.create(project=left, user=reader, role="maintainer")

    owner_client = authenticated(owner)
    read_client = authenticated(reader)
    url = f"/api/projects/{left.pk}/software/"
    a = register(owner_client, repository, "a", "客户端").json()["data"]
    ProjectSoftware.objects.create(project=left, software_id=a["id"], is_active=False)
    b = register(owner_client, repository, "b", "服务端").json()["data"]
    current = read_client.get(url, {"active": "true"}).json()["data"]
    assert {row["software"]["id"] for row in current} == {a["id"], b["id"]}
    assert read_client.get(f"/api/software/?repository={repository.pk}").json()["data"]["total"] == 2
    assert read_client.get(f"/api/projects/{right.pk}/software/").status_code == 404

    assert owner_client.patch(f"/api/software/{b['id']}/", {"is_active": False}, format="json").status_code == 200
    assert [row["software"]["id"] for row in read_client.get(url, {"active": "true"}).json()["data"]] == [a["id"]]
    component_url = f"/api/projects/{left.pk}/components/{component.pk}/"
    assert authenticated(manager).patch(component_url, {"is_active": False}, format="json").status_code == 200
    assert read_client.get(url).json()["data"] == []
    assert read_client.get(f"/api/software/{a['id']}/").status_code == 404
    assert ProjectSoftware.objects.filter(project=left, software_id=a["id"], is_active=False).exists()
