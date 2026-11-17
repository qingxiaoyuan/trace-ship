"""
仓库模块开放接口测试（/api/open/compare/）

验证两个 tag 间 commits 与 MRs 查询的业务行为，GitLab 调用通过 patch
get_provider 模拟，不访问真实网络。
"""
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from rest_framework.test import APIClient

from apps.system.models import AccessToken
from utils.provider.base import CommitInfo, MergeRequestInfo, TagInfo
from utils.provider.exceptions import ProviderError

URL = "/api/open/compare/"


def _auth_client(scopes: list[str]) -> APIClient:
    """创建令牌并返回携带 Bearer token 的客户端"""
    plain = AccessToken.generate_token()
    token = AccessToken(name="开放接口测试", scopes=scopes)
    token.set_token(plain)
    token.save()
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {plain}")
    return client


@pytest.fixture(autouse=True)
def _clear_tag_cache():
    """compare 视图的 tag 列表走短 TTL 缓存，每个测试前后清空避免跨测试污染"""
    from django.core.cache import cache
    cache.clear()
    yield
    cache.clear()


def _mock_provider() -> MagicMock:
    """构造模拟 GitProvider：两个 tag、区间 commits 与 MRs"""
    provider = MagicMock()
    provider.list_tags.return_value = [
        TagInfo(name="v1.0.0", commit_hash="aaa", created_at=datetime(2026, 6, 1, tzinfo=UTC)),
        TagInfo(name="v1.1.0", commit_hash="bbb", created_at=datetime(2026, 7, 1, tzinfo=UTC)),
    ]
    provider.compare_commits.return_value = [
        CommitInfo(
            hash="abc123",
            author="张三",
            author_email="zhangsan@example.com",
            message="feat: 新增功能",
            committed_at=datetime(2026, 6, 15, tzinfo=UTC),
        ),
    ]
    provider.list_merge_requests.return_value = [
        MergeRequestInfo(
            number="1",
            title="新增功能",
            author="张三",
            source_branch="feature/a",
            target_branch="develop",
            web_url="https://gitlab.example.com/mr/1",
            merged_at=datetime(2026, 6, 16, tzinfo=UTC),
        ),
        # 合并时间晚于 to_tag，应被过滤掉
        MergeRequestInfo(
            number="2",
            title="区间外 MR",
            merged_at=datetime(2026, 7, 2, tzinfo=UTC),
        ),
    ]
    return provider


@pytest.mark.django_db
class TestOpenTagCompare:
    """两个 tag 间的 commits 与 MRs 查询"""

    def test_compare_success(self, repository):
        """合法请求返回区间 commits 与过滤后的 MRs"""
        client = _auth_client(["repo.compare"])
        with patch("apps.repository.views_open.get_provider", return_value=_mock_provider()):
            response = client.get(URL, {
                "repository_id": str(repository.id),
                "from_tag": "v1.0.0",
                "to_tag": "v1.1.0",
            })
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["from_tag"] == "v1.0.0"
        assert data["to_tag"] == "v1.1.0"
        assert len(data["commits"]) == 1
        assert data["commits"][0]["hash"] == "abc123"
        # 仅保留 merged_at <= to_tag 时间的 MR
        assert [mr["number"] for mr in data["mrs"]] == ["1"]

    def test_tag_not_found(self, repository):
        """tag 不存在返回 404"""
        client = _auth_client(["repo.compare"])
        with patch("apps.repository.views_open.get_provider", return_value=_mock_provider()):
            response = client.get(URL, {
                "repository_id": str(repository.id),
                "from_tag": "v9.9.9",
                "to_tag": "v1.1.0",
            })
        assert response.status_code == 404

    def test_repository_not_found(self):
        """仓库不存在返回 404"""
        client = _auth_client(["repo.compare"])
        response = client.get(URL, {
            "repository_id": "00000000-0000-0000-0000-000000000000",
            "from_tag": "v1.0.0",
            "to_tag": "v1.1.0",
        })
        assert response.status_code == 404

    def test_provider_failure(self, repository):
        """GitLab 调用失败返回 502"""
        provider = _mock_provider()
        provider.list_tags.side_effect = ProviderError("连接超时")
        client = _auth_client(["repo.compare"])
        with patch("apps.repository.views_open.get_provider", return_value=provider):
            response = client.get(URL, {
                "repository_id": str(repository.id),
                "from_tag": "v1.0.0",
                "to_tag": "v1.1.0",
            })
        assert response.status_code == 502

    def test_missing_params(self, repository):
        """缺少必填参数返回 400"""
        client = _auth_client(["repo.compare"])
        assert client.get(URL, {"repository_id": str(repository.id)}).status_code == 400

    def test_指定软件比较时仅接受明确归属的软件Tag(self, project, repository, user):
        from apps.release.models import ReleaseRecord
        from apps.software.models import ProjectSoftware, Software

        a = Software.objects.create(repository=repository, owner=user, name="软件 A", slug="app-a")
        b = Software.objects.create(repository=repository, owner=user, name="软件 B", slug="app-b")
        for software in (a, b):
            ProjectSoftware.objects.create(project=project, software=software)
        from_sha, to_sha = "a" * 40, "b" * 40
        for software, tag, git_hash in [(a, "v1.0.0", from_sha), (a, "app-a/v1.1.0", to_sha), (b, "app-b/v1.1.0", to_sha)]:
            ReleaseRecord.objects.create(project=project, repository=repository, software=software,
                                         status="released", tag_name=tag, git_hash=git_hash)
        provider = _mock_provider()
        from_tag, to_tag = provider.list_tags.return_value
        from_tag.commit_hash = from_sha
        to_tag.name = "app-a/v1.1.0"
        to_tag.commit_hash = to_sha
        arguments = {"project_id": str(project.pk), "software_id": str(a.pk),
                     "from_tag": "v1.0.0", "to_tag": "app-a/v1.1.0"}
        client = _auth_client(["repo.compare"])
        with patch("apps.repository.views_open.get_provider", return_value=provider):
            result = client.get(URL, arguments)
        assert result.status_code == 200, result.data
        assert result.data["data"]["software_id"] == str(a.pk)
        assert result.data["data"]["to_tag"] == "app-a/v1.1.0"
        assert result.data["data"]["from_git_hash"] == from_sha
        assert result.data["data"]["to_git_hash"] == to_sha
        provider.compare_commits.assert_called_once_with(repository.external_identity, from_sha, to_sha)
        assert client.get(URL, {**arguments, "to_tag": "app-b/v1.1.0"}).status_code == 404
        assert _auth_client(["release.doc"]).get(URL, arguments).status_code == 403

    def test_软件比较拒绝Tag移动而原仓库比较仍可查询(self, project, repository, user):
        from django.core.cache import cache

        from apps.release.models import ReleaseRecord
        from apps.software.models import ProjectSoftware, Software

        software = Software.objects.create(repository=repository, owner=user, name="已归属软件", slug="app")
        ProjectSoftware.objects.create(project=project, software=software)
        from_sha, saved_sha, moved_sha = "a" * 40, "b" * 40, "c" * 40
        for tag, git_hash in [("v1.0.0", from_sha), ("v1.1.0", saved_sha)]:
            ReleaseRecord.objects.create(project=project, repository=repository, software=software,
                                         status="released", tag_name=tag, git_hash=git_hash)
        provider = _mock_provider()
        provider.list_tags.return_value[0].commit_hash = from_sha
        provider.list_tags.return_value[1].commit_hash = moved_sha
        arguments = {"repository_id": str(repository.pk), "from_tag": "v1.0.0", "to_tag": "v1.1.0"}
        client = _auth_client(["repo.compare"])
        with patch("apps.repository.views_open.get_provider", return_value=provider):
            software_result = client.get(URL, {**arguments, "software_id": str(software.pk)})
            assert software_result.status_code == 409
            provider.compare_commits.assert_not_called()

            cache.clear()
            legacy_result = client.get(URL, arguments)
            assert legacy_result.status_code == 200
            assert legacy_result.data["data"]["to_git_hash"] == moved_sha
            provider.compare_commits.assert_called_once_with(repository.external_identity, "v1.0.0", "v1.1.0")
