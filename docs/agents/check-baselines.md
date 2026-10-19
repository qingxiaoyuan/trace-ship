# 自动检查的已知失败基线

本文件记录已经实际观测到的失败，用于区分存量问题与新增失败。执行入口、检查项和报告产物见 [PR 自动检查](pr-checks.md)。关联任务为 [#34](https://github.com/qingxiaoyuan/trace-ship/issues/34)。

**已知失败仍然是失败。** 本记录不参与检查结果计算，不是允许失败的名单。不得据此跳过测试、添加 `xfail`、降低覆盖率门槛、设置 `continue-on-error` 或将非零退出码改成成功。只有实际命令成功的检查才可标记为通过；“与基线相同”只能说明未观测到新增失败。

## 2026-10-19：Windows 后端全量检查

| 项目 | 实测值 |
| --- | --- |
| 代码基点 | `caf759ab6ca7603009b7a0c203d29c60ee70bfed`（已合入 #25） |
| 平台与运行时 | Windows，Python 3.12.12，pytest 9.1.1，Django 5.0.14 |
| 测试配置 | `backend/pytest.ini`，`config.settings.test`；保留完整默认参数及 50% 覆盖率门槛 |
| 执行上下文 | 仓库根目录；`TEMP`、`TMP` 指向仓库内 `tmp/pr-checks/temp`；`PYTHONIOENCODING=utf-8` |
| 测试结果 | 收集 923 项：904 passed、15 failed、4 skipped、5 warnings；命令退出码 **1** |
| 覆盖率 | **86.31%**，达到 50% 门槛；覆盖率达标不改变测试命令失败的结果 |
| 总体结论 | **失败，尚未修复下列 15 项** |

当次实际执行命令如下。这是该次基线的历史记录，后续自动检查入口仍以工作流为准；覆盖率范围来自 `pytest.ini`，没有追加过滤或忽略参数。

```powershell
# 在仓库根目录执行
New-Item -ItemType Directory -Force tmp/pr-checks/temp | Out-Null
$env:TEMP = Join-Path (Get-Location) 'tmp/pr-checks/temp'
$env:TMP = $env:TEMP
$env:PYTHONIOENCODING = 'utf-8'
& backend/.venv/Scripts/python.exe -m pytest -c backend/pytest.ini backend --junitxml=tmp/pr-checks/backend-junit.xml --cov-report=xml:tmp/pr-checks/backend-coverage.xml *> tmp/pr-checks/backend-pytest.log
$checkExit = $LASTEXITCODE # 当次为 1
```

本地原始证据为 `tmp/pr-checks/backend-pytest.log`、`tmp/pr-checks/backend-junit.xml` 和 `tmp/pr-checks/backend-coverage.xml`。`tmp/` 不入库，供本次复核使用；后续 PR 以对应检查运行上传的日志、JUnit 和覆盖率报告为证据，记录运行链接与被测提交，不依赖他人拥有这些本地文件。

下列节点均为本次真实失败。症状中的平台关联是排查线索，尚不代表根因修复或跨平台验证完成。

| 失败节点（相对仓库根目录） | 实际症状 |
| --- | --- |
| `backend/apps/package/tests/test_scm_enhancements.py::TestGitCredentialInjection::test_enabled_injects_askpass_and_identity` | Windows 文件模式不满足 `stat.S_IXUSR` 执行位断言。 |
| `backend/apps/package/tests/test_services.py::test_container_package_uses_workspace_and_overrides_env` | Docker 挂载参数与断言中的路径分隔符不一致。 |
| `backend/apps/package/tests/test_services.py::test_custom_script_ec_fails_fast_on_mid_script_error` | 执行 `/bin/sh` 时出现 `FileNotFoundError: [WinError 2]`。 |
| `backend/apps/package/tests/test_services.py::test_run_command_terminates_process_group_when_task_canceled` | Windows `os` 模块不存在被测试替换的 `killpg` 属性。 |
| `backend/apps/package/tests/test_views.py::test_download_all_artifacts_success` | 响应 MIME 为 `application/x-zip-compressed`，断言预期 `application/zip`。 |
| `backend/apps/package/tests/test_views.py::TestTaskLogsIncremental::test_full_log_default` | 返回日志为 CRLF，断言预期 LF。 |
| `backend/apps/package/tests/test_views.py::TestTaskLogsIncremental::test_tail_returns_last_bytes` | 文件实测 210 字节，按 LF 计算的预期为 200 字节。 |
| `backend/apps/package/tests/test_views.py::TestTaskLogsIncremental::test_tail_larger_than_file` | 完整返回的日志为 CRLF，断言预期 LF。 |
| `backend/apps/package/tests/test_views.py::TestTaskLogsIncremental::test_offset_returns_increment` | CRLF 下的文件字节偏移与按 LF 计算的切片不一致。 |
| `backend/apps/package/tests/test_views.py::TestTaskLogsIncremental::test_offset_beyond_size_falls_back_full` | 回退返回的完整日志为 CRLF，断言预期 LF。 |
| `backend/apps/release/tests/test_source_execution.py::test_cleaned_rc_checkout_preserves_sha_and_stops_before_build_on_drift[False]` | 任务因 `[WinError 10038]` 非套接字操作而失败，预期成功。 |
| `backend/apps/release/tests/test_source_execution.py::test_cleaned_rc_checkout_preserves_sha_and_stops_before_build_on_drift[True]` | 错误被 `[WinError 10038]` 覆盖，未出现预期的“实际检出”提示。 |
| `backend/apps/repository/tests/test_branches.py::test_sync_branches_persists_to_db` | 分支同步数量为 1，预期为 2；平台关联尚未确认。 |
| `backend/apps/repository/tests/test_branches.py::test_sync_branches_removes_deleted_remote_branch` | 同步后的分支数量为 1，预期为 2；平台关联尚未确认。 |
| `backend/apps/repository/tests/test_branches.py::test_sync_branches_skips_stale_branches` | 分支同步数量为 1，预期为 2；平台关联尚未确认。 |

同次准备工作中，前端 ESLint 扫描 224 个文件，退出码 0、0 错误、0 警告；后端 Ruff 检查退出码 0、0 诊断。它们是各自检查通过的证据，不能抵消后端测试失败。

## 平台与历史证据的边界

PR 后端自动检查使用 Ubuntu 24.04 与 Python 3.11，保留独立的全量测试结果。首次运行之前，该环境的结果为**未验证**；不得预设它会通过，也不得将上述 Windows 15 项失败当作 Linux 的预期失败。尤其是三个分支同步失败，须依实际运行继续排查。

#25 实施期间曾在历史 `master` 观测到 896 passed、相同 15 failed、4 skipped；增加 #25 测试后为 904 passed、相同 15 failed、4 skipped。这只能作为失败早已存在的历史证据，不代表历史检查通过，也不替代本次覆盖率与退出码记录。当时另一份受沙箱临时目录权限影响的日志包含额外失败，不作为本表的业务失败基线。

## 后续更新要求

- 发现新增失败时，单独列出新增节点、被测提交、平台、命令退出码和证据链接，不以存量失败掩盖新增问题。
- 修复本表中的失败后，附对应回归测试和完整检查结果，将该项注明为已修复并保留原记录，不静默删除历史证据。
- 检查因依赖安装、环境或权限问题无法执行时，记录为未完成或执行失败，不填入通过计数。
- 更新平台、运行时、依赖或覆盖率范围后重新测量，注明结果不可直接与旧环境等同。
