import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import Project, ProjectMember


@pytest.fixture
def manager():
    return User.objects.create_user(username="manager", password="pass")


@pytest.fixture
def developer():
    return User.objects.create_user(username="developer", password="pass")


@pytest.fixture
def outsider():
    return User.objects.create_user(username="outsider", password="pass")


@pytest.fixture
def project(manager, developer):
    project = Project.objects.create(code="PERM", name="权限项目", leader=manager)
    ProjectMember.objects.create(project=project, user=manager, role="manager")
    ProjectMember.objects.create(project=project, user=developer, role="developer")
    return project


def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_project_manager_can_list_members(project, manager):
    response = auth_client(manager).get(f"/api/projects/{project.id}/members/")

    assert response.status_code == 200


@pytest.mark.django_db
def test_project_developer_cannot_list_members(project, developer):
    response = auth_client(developer).get(f"/api/projects/{project.id}/members/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_non_member_cannot_list_integrations(project, outsider):
    response = auth_client(outsider).get(f"/api/projects/{project.id}/integrations/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_project_developer_cannot_create_integration(project, developer):
    payload = {
        "integration_type": "git_repo",
        "vendor": "gitlab",
        "name": "GitLab",
        "external_identity": "group/repo",
        "config": {"server_url": "https://gitlab.example.com"},
        "credential_mode": "fixed",
        "is_active": True,
    }

    response = auth_client(developer).post(
        f"/api/projects/{project.id}/integrations/",
        payload,
        format="json",
    )

    assert response.status_code == 403
