"""
SVNProvider 单元测试

使用 mock 模拟 svn 命令行输出。
"""
from unittest.mock import patch

import pytest

from utils.provider.exceptions import ConnectionError
from utils.provider.svn import SVNProvider

SAMPLE_LOG_XML = """<?xml version="1.0"?>
<log>
<logentry revision="100">
<author>zhangsan</author>
<date>2026-06-20T10:00:00.000000Z</date>
<msg>变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A xxx</msg>
</logentry>
<logentry revision="99">
<author>lisi</author>
<date>2026-06-19T10:00:00.000000Z</date>
<msg>bad message</msg>
</logentry>
</log>
"""


@pytest.fixture
def provider():
    """SVNProvider 实例"""
    return SVNProvider("https://svn.example.com/repo", {"username": "user", "password": "pass"})


def test_test_connection_success(provider):
    """测试 SVN 连通性成功"""
    with patch("utils.provider.svn.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stderr = ""
        assert provider.test_connection() is True
        args = mock_run.call_args[0][0]
        assert "svn" in args
        assert "info" in args


def test_test_connection_failure(provider):
    """测试 SVN 认证失败"""
    with patch("utils.provider.svn.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 1
        mock_run.return_value.stderr = "认证失败"
        with pytest.raises(ConnectionError):
            provider.test_connection()


def test_list_commits(provider):
    """测试 SVN 日志解析"""
    with patch("utils.provider.svn.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stderr = ""
        mock_run.return_value.stdout = SAMPLE_LOG_XML
        commits = provider.list_commits()
        assert len(commits) == 2
        assert commits[0].hash == "100"
        assert commits[0].author == "zhangsan"
        assert commits[1].hash == "99"


def test_svn_command_not_found(provider):
    """测试未安装 svn 命令"""
    with patch("utils.provider.svn.subprocess.run", side_effect=FileNotFoundError()):
        with pytest.raises(ConnectionError) as exc_info:
            provider.test_connection()
        assert "未找到 svn" in str(exc_info.value)


def test_replace_file_success(provider, tmp_path):
    """替换远程文件：checkout -> 覆盖 -> commit"""
    local = tmp_path / "release-VA.1.0.0.md"
    local.write_text("new doc content", encoding="utf-8")
    workcopy = tmp_path / "wc"
    workcopy.mkdir()
    (workcopy / "release-VA.1.0.0.md").write_text("old doc", encoding="utf-8")

    with (
        patch("utils.provider.svn.subprocess.run") as mock_run,
        patch("utils.provider.svn.tempfile.mkdtemp", return_value=str(workcopy)),
        patch("utils.provider.svn.shutil.rmtree") as mock_rmtree,
    ):
        mock_run.return_value.returncode = 0
        mock_run.return_value.stderr = ""
        provider.replace_file(
            "https://svn.example.com/repo/VA.1.0.0", str(local), "Release doc update"
        )

    assert (workcopy / "release-VA.1.0.0.md").read_text(encoding="utf-8") == "new doc content"
    calls = mock_run.call_args_list
    assert len(calls) == 2
    assert "checkout" in calls[0].args[0]
    assert "commit" in calls[1].args[0]
    mock_rmtree.assert_called_once()


def test_replace_file_missing_target_raises(provider, tmp_path):
    """远程目录中不存在同名文件时报 NotFoundError"""
    local = tmp_path / "release-VA.1.0.0.md"
    local.write_text("new", encoding="utf-8")
    workcopy = tmp_path / "wc"
    workcopy.mkdir()

    with (
        patch("utils.provider.svn.subprocess.run") as mock_run,
        patch("utils.provider.svn.tempfile.mkdtemp", return_value=str(workcopy)),
    ):
        mock_run.return_value.returncode = 0
        mock_run.return_value.stderr = ""
        from utils.provider.exceptions import NotFoundError

        with pytest.raises(NotFoundError):
            provider.replace_file(
                "https://svn.example.com/repo/VA.1.0.0", str(local), "msg"
            )


def test_replace_file_skips_commit_when_content_unchanged(provider, tmp_path):
    """远程文件内容一致时跳过 commit，避免 'no changes' 误报失败"""
    local = tmp_path / "release-VA.1.0.0.md"
    local.write_text("same content", encoding="utf-8")
    workcopy = tmp_path / "wc"
    workcopy.mkdir()
    (workcopy / "release-VA.1.0.0.md").write_text("same content", encoding="utf-8")

    with (
        patch("utils.provider.svn.subprocess.run") as mock_run,
        patch("utils.provider.svn.tempfile.mkdtemp", return_value=str(workcopy)),
        patch("utils.provider.svn.shutil.rmtree") as mock_rmtree,
    ):
        mock_run.return_value.returncode = 0
        mock_run.return_value.stderr = ""
        provider.replace_file(
            "https://svn.example.com/repo/VA.1.0.0", str(local), "Release doc update"
        )

    # 只 checkout，不 commit
    calls = mock_run.call_args_list
    assert len(calls) == 1
    assert "checkout" in calls[0].args[0]
    mock_rmtree.assert_called_once()
