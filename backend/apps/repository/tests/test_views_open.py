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
