"""
发布模块开放接口测试（/api/open/release-doc/）

验证按 tag 查询发布变更文档的业务行为：
- 仅放行 status=released 的记录
- 参数缺失 / 未命中的错误码
"""
import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from apps.system.models import AccessToken

URL = "/api/open/release-doc/"


def _auth_client(scopes: list[str]) -> APIClient:
    """创建令牌并返回携带 Bearer token 的客户端"""
    plain = AccessToken.generate_token()
    token = AccessToken(name="开放接口测试", scopes=scopes)
    token.set_token(plain)
    token.save()
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {plain}")
    return client


def _make_release(project, repository, tag: str, status: str) -> ReleaseRecord:
    """创建发布记录"""
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version=tag,
        tag_name=tag,
        branch="develop",
        release_type="formal",
        status=status,
        release_doc="| 类型 | 内容 |\n| A | 新增功能 |",
        config_change_doc="无",
    )


@pytest.mark.django_db
class TestOpenReleaseDoc:
    """按 tag 查询发布变更文档"""

    def test_released_record_returned(self, project, repository):
        """已发布记录可查询，返回白名单字段"""
        _make_release(project, repository, "VA.1.0.0", "released")
        client = _auth_client(["release.doc"])
        response = client.get(URL, {"tag": "VA.1.0.0", "repository_id": str(repository.id)})
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["tag_name"] == "VA.1.0.0"
        assert data["project_name"] == project.name
        assert data["repository_name"] == repository.name
        assert "新增功能" in data["release_doc"]
        # 不暴露内部字段
        assert "workflow_instance" not in data
        assert "rejected_reason" not in data

    def test_draft_record_not_exposed(self, project, repository):
        """草稿状态发布不对外暴露，返回 404"""
        _make_release(project, repository, "VA.1.0.1", "draft")
        client = _auth_client(["release.doc"])
        response = client.get(URL, {"tag": "VA.1.0.1", "repository_id": str(repository.id)})
        assert response.status_code == 404
    def test_missing_params_bad_request(self, repository):
        """缺少必填参数返回 400"""
        client = _auth_client(["release.doc"])
        assert client.get(URL).status_code == 400
        assert client.get(URL, {"tag": "VA.1.0.0"}).status_code == 400

    def test_tag_not_found(self, repository):
        """tag 无对应发布记录返回 404"""
        client = _auth_client(["release.doc"])
        response = client.get(URL, {"tag": "VA.9.9.9", "repository_id": str(repository.id)})
        assert response.status_code == 404

    def test_按软件查询原始Tag与带前缀Tag且不扩大令牌范围(self, project, repository, user):
        from apps.software.models import Software

        a = Software.objects.create(repository=repository, owner=user, name="软件 A", slug="app-a")
        b = Software.objects.create(repository=repository, owner=user, name="软件 B", slug="app-b")
        history = _make_release(project, repository, "VA.1.0.0", "released")
        history.software = a
        history.save(update_fields=["software"])
        current = _make_release(project, repository, "app-a/VA.1.0.1", "released")
        current.software = a
        current.git_hash = "a" * 40
        current.source_repository_name_snapshot = "发布时仓库名称"
        current.save(update_fields=["software", "git_hash", "source_repository_name_snapshot"])
        _make_release(project, repository, "VA.0.0.1", "released")
        api = _auth_client(["release.doc"])
        assert api.get(URL, {"software_id": str(b.pk), "tag": current.tag_name}).status_code == 404
        assert _auth_client(["repo.compare"]).get(URL, {"software_id": str(a.pk), "tag": current.tag_name}).status_code == 403
        for release in [history, current]:
            response = api.get(URL, {"software_id": str(a.pk), "tag": release.tag_name})
            assert response.status_code == 200
            data = response.data["data"]
            assert data["software_id"] == str(a.pk) and data["software_name"] == "软件 A"
            assert data["tag_name"] == release.tag_name and data["git_hash"] == release.git_hash
            assert data["repository_name"] == (release.source_repository_name_snapshot or repository.name)
        unknown = api.get(URL, {"repository_id": str(repository.pk), "tag": "VA.0.0.1"}).data["data"]
        assert unknown["software_id"] is None and unknown["software_name"] is None
        assert api.get(URL, {"repository_id": "invalid", "tag": "VA.0.0.1"}).status_code == 400
