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
