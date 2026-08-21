"""
GitLabProvider 单元测试

使用 responses 库模拟 GitLab REST API。
"""
from urllib.parse import quote

import pytest
import responses

from utils.provider.exceptions import AuthenticationError, NotFoundError, ProviderError
from utils.provider.gitlab import GitLabProvider


@pytest.fixture
def provider():
    """GitLabProvider 实例"""
    return GitLabProvider("https://gitlab.example.com", {"token": "glpat-test"})


@responses.activate
def test_test_connection_success(provider):
    """测试连通性成功"""
    responses.add(
        responses.GET,
        "https://gitlab.example.com/api/v4/user",
        json={"id": 1, "username": "test"},
        status=200,
    )
    assert provider.test_connection() is True


@responses.activate
def test_test_connection_auth_failure(provider):
    """测试 Token 认证失败"""
    responses.add(
        responses.GET,
        "https://gitlab.example.com/api/v4/user",
        json={"message": "401 Unauthorized"},
        status=401,
    )
    with pytest.raises(AuthenticationError):
        provider.test_connection()


@responses.activate
def test_list_branches(provider):
    """测试分支列表"""
    encoded = quote("group/project", safe="")
    responses.add(
        responses.GET,
        f"https://gitlab.example.com/api/v4/projects/{encoded}/repository/branches",
        json=[
            {"name": "main", "default": True, "commit": {"id": "abc123"}},
            {"name": "develop", "default": False, "commit": {"id": "def456"}},
        ],
        status=200,
    )
    branches = provider.list_branches("group/project")
    assert len(branches) == 2
    assert branches[0].name == "main"
    assert branches[0].is_default is True


@responses.activate
def test_list_branches_paginates_all_pages(provider):
    """测试分支列表自动翻页，突破单页 100 条限制"""
    encoded = quote("group/project", safe="")
    url = f"https://gitlab.example.com/api/v4/projects/{encoded}/repository/branches"
    responses.add(
        responses.GET,
        url,
        json=[{"name": f"feature-{i}", "default": False, "commit": {"id": f"h{i}"}} for i in range(100)],
        headers={"X-Next-Page": "2"},
        status=200,
    )
    responses.add(
        responses.GET,
        url,
        json=[{"name": "main", "default": True, "commit": {"id": "abc123"}}],
        status=200,
    )
    branches = provider.list_branches("group/project")
    assert len(branches) == 101
    assert responses.calls[0].request.params["page"] == "1"
    assert responses.calls[1].request.params["page"] == "2"


@responses.activate
def test_list_commits(provider):
    """测试 commit 列表"""
    encoded = quote("group/project", safe="")
    responses.add(
        responses.GET,
        f"https://gitlab.example.com/api/v4/projects/{encoded}/repository/commits",
        json=[
            {
                "id": "abc123",
                "author_name": "张三",
                "author_email": "zhangsan@example.com",
                "message": "变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A xxx",
                "committed_date": "2026-06-20T10:00:00.000Z",
            }
        ],
        status=200,
    )
    commits = provider.list_commits("group/project", "develop")
    assert len(commits) == 1
    assert commits[0].hash == "abc123"
    assert commits[0].author == "张三"


@responses.activate
def test_list_commits_not_found(provider):
    """测试仓库不存在"""
    encoded = quote("group/notfound", safe="")
    responses.add(
        responses.GET,
        f"https://gitlab.example.com/api/v4/projects/{encoded}/repository/commits",
        json={"message": "404 Project Not Found"},
        status=404,
    )
    with pytest.raises(ProviderError):
        provider.list_commits("group/notfound", "develop")


@responses.activate
def test_delete_tag_success(provider):
    """删除远端 tag 成功（tag 名需 URL 编码）"""
    encoded = quote("group/project", safe="")
    encoded_tag = quote("VA.1.0.0_20260814", safe="")
    url = f"https://gitlab.example.com/api/v4/projects/{encoded}/repository/tags/{encoded_tag}"
    responses.add(responses.DELETE, url, status=204)

    provider.delete_tag("group/project", "VA.1.0.0_20260814")

    assert responses.calls[0].request.method == "DELETE"
    assert responses.calls[0].request.url == url


@responses.activate
def test_delete_tag_not_found(provider):
    """远端 tag 不存在时抛出 NotFoundError，供调用方幂等处理"""
    encoded = quote("group/project", safe="")
    encoded_tag = quote("VA.1.0.0_20260814", safe="")
    responses.add(
        responses.DELETE,
        f"https://gitlab.example.com/api/v4/projects/{encoded}/repository/tags/{encoded_tag}",
        json={"message": "404 Tag Not Found"},
        status=404,
    )

    with pytest.raises(NotFoundError):
        provider.delete_tag("group/project", "VA.1.0.0_20260814")
