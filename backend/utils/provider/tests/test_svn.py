import pytest
from unittest.mock import patch

from utils.provider.svn import SVNProvider
from utils.provider.exceptions import ConnectionError


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
    return SVNProvider("https://svn.example.com/repo", {"username": "user", "password": "pass"})


def test_test_connection_success(provider):
    with patch("utils.provider.svn.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stderr = ""
        assert provider.test_connection() is True
        args = mock_run.call_args[0][0]
        assert "svn" in args
        assert "info" in args


def test_test_connection_failure(provider):
    with patch("utils.provider.svn.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 1
        mock_run.return_value.stderr = "认证失败"
        with pytest.raises(ConnectionError):
            provider.test_connection()


def test_list_commits(provider):
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
    with patch("utils.provider.svn.subprocess.run", side_effect=FileNotFoundError()):
        with pytest.raises(ConnectionError) as exc_info:
            provider.test_connection()
        assert "未找到 svn" in str(exc_info.value)
