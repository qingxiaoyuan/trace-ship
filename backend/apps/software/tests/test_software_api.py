"""软件登记与项目选用的公开接口验收。"""

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


def test_delegate_can_edit_until_revoked_and_cannot_take_over_or_grant(owner, repository):
    owner_client = authenticated(owner)
    software = register(owner_client, repository, "client-a", "客户端").json()["data"]
    url = f"/api/software/{software['id']}/"
    delegate = User.objects.create_user(username="software-delegate", password="pass")
    delegate_client = authenticated(delegate)
    assert delegate_client.get(url).status_code == 404

    grant = owner_client.post(f"{url}maintainers/", {"username": delegate.username}, format="json")
    assert grant.status_code == 200, grant.content
    assert delegate_client.get(url).json()["data"]["can_maintain"] is True
    assert delegate_client.patch(url, {"name": "协作维护"}, format="json").status_code == 200
    assert delegate_client.patch(url, {"is_active": False}, format="json").status_code == 403
    assert delegate_client.patch(url, {"owner_username": delegate.username}, format="json").status_code == 403
    assert delegate_client.post(f"{url}maintainers/", {"username": owner.username}, format="json").status_code == 403

    assert owner_client.delete(f"{url}maintainers/{delegate.pk}/").status_code == 200
    assert delegate_client.patch(url, {"name": "已撤销"}, format="json").status_code == 404
    assert owner_client.get(url).json()["data"]["name"] == "协作维护"

    transferred = owner_client.patch(url, {"owner_username": delegate.username}, format="json")
    assert transferred.status_code == 200
    assert transferred.json()["data"]["owner"]["id"] == str(delegate.pk)
    assert delegate_client.patch(url, {"is_active": False}, format="json").status_code == 200
    assert client_as_superuser().patch(url, {"is_active": True}, format="json").status_code == 200


def client_as_superuser():
    return authenticated(User.objects.create_superuser(username="software-superuser", password="pass"))


def choose(client, project, item):
    return client.post(f"/api/projects/{project.pk}/software/", {"software": item["id"]}, format="json")


def selected(client, project):
    return client.get(f"/api/projects/{project.pk}/software/").json()["data"]


def test_explicit_selection_is_project_scoped_and_preserved_on_stop(owner, repository):
    from apps.project.models import Project, ProjectComponent, ProjectMember

    manager = User.objects.create_user(username="software-manager", password="pass")
    maintainer = User.objects.create_user(username="project-maintainer", password="pass")
    left = Project.objects.create(name="项目甲", code="LEFT")
    right = Project.objects.create(name="项目乙", code="RIGHT")
    components = {}
    for project in (left, right):
        components[project.pk] = ProjectComponent.objects.create(
            project=project,
            repository=repository,
            component_code="software",
            display_name="源码",
        )
        ProjectMember.objects.create(project=project, user=manager, role="software_admin")
    ProjectMember.objects.create(project=left, user=owner, role="developer")
    ProjectMember.objects.create(project=left, user=maintainer, role="maintainer")

    owner_client = authenticated(owner)
    manager_client = authenticated(manager)
    read_client = authenticated(maintainer)
    a, b, c = [register(owner_client, repository, slug, slug.upper()).json()["data"] for slug in ("a", "b", "c")]
    assert selected(manager_client, left) == []
    assert read_client.get(f"/api/projects/{left.pk}/software/available/").status_code == 403
    assert choose(read_client, left, a).status_code == 403
    assert choose(manager_client, right, b).status_code == 400
    ProjectMember.objects.create(project=right, user=owner, role="developer")

    for project, items in ((left, (a, b)), (right, (b, c))):
        for item in items:
            response = choose(manager_client, project, item)
            assert response.status_code == 201, response.content

    assert {row["software"]["id"] for row in selected(read_client, left)} == {a["id"], b["id"]}
    assert read_client.get(f"/api/software/{c['id']}/").status_code == 404
    assert read_client.get(f"/api/projects/{right.pk}/software/").status_code == 404
    detail = f"/api/software/{b['id']}/"
    grant = owner_client.post(f"{detail}maintainers/", {"username": "nonexistent"}, format="json")
    assert grant.status_code == 400
    assert manager_client.patch(detail, {"name": "不能覆盖共享名称"}, format="json").status_code == 403

    outsider = User.objects.create_user(username="outside-project", password="pass")
    assert owner_client.post(f"{detail}maintainers/", {"username": outsider.username}, format="json").status_code == 200
    assert choose(authenticated(outsider), left, b).status_code == 404

    row = next(row for row in selected(manager_client, left) if row["software"]["id"] == b["id"])
    selection_url = f"/api/projects/{left.pk}/software/{row['id']}/"
    assert manager_client.patch(selection_url, {"is_active": False}, format="json").status_code == 200
    assert manager_client.delete(selection_url).status_code == 405
    assert next(row for row in selected(read_client, left) if row["software"]["id"] == b["id"])["is_active"] is False
    assert next(row for row in selected(manager_client, right) if row["software"]["id"] == b["id"])["is_active"] is True
    assert owner_client.patch(detail, {"is_active": False}, format="json").status_code == 200
    assert manager_client.patch(selection_url, {"is_active": True}, format="json").status_code == 400
    assert (
        next(row for row in selected(manager_client, right) if row["software"]["id"] == b["id"])["software"][
            "is_active"
        ]
        is False
    )
    repository_url = f"/api/repositories/{repository.pk}/"
    assert read_client.get(repository_url).status_code == 200
    historical = next(row for row in selected(read_client, left) if row["software"]["id"] == b["id"])
    assert historical["can_view_repository"] is True
    live = next(row for row in selected(read_client, left) if row["software"]["id"] == a["id"])
    assert live["is_usable"] is True

    component_url = f"/api/projects/{left.pk}/components/{components[left.pk].pk}/"
    assert manager_client.patch(component_url, {"is_active": False}, format="json").status_code == 200
    hidden_repository = next(row for row in selected(read_client, left) if row["software"]["id"] == b["id"])
    assert hidden_repository["id"] == historical["id"]
    assert hidden_repository["software"]["name"] == "B"
    assert hidden_repository["software"]["repository_name"] == repository.name
    assert hidden_repository["can_view_repository"] is False
    unavailable = next(row for row in selected(read_client, left) if row["software"]["id"] == a["id"])
    assert unavailable["is_active"] is True
    assert unavailable["is_usable"] is False
    assert read_client.get(repository_url).status_code == 404
    still_visible = next(row for row in selected(manager_client, left) if row["software"]["id"] == b["id"])
    assert still_visible["can_view_repository"] is True
    assert still_visible["is_usable"] is False

    repo_deletion = client_as_superuser().delete(f"/api/repositories/{repository.pk}/")
    assert repo_deletion.status_code == 409, repo_deletion.content
    assert manager_client.delete(f"/api/projects/{left.pk}/").status_code == 409
