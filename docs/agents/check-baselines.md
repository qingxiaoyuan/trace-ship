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

## 2026-10-19：首次 Ubuntu PR 自动检查

实际运行见 [PR #35 首次检查](https://github.com/qingxiaoyuan/trace-ship/actions/runs/39224513406)。五项检查均完成，前端 lint、162 项全量测试、类型检查/构建及后端 Ruff 通过；后端测试失败没有取消其他检查。五份独立证据包均上传成功，前后端测试 ZIP 已下载核验，包含原始日志与 JUnit，后端另含覆盖率 XML。

| 项目 | 实测值 |
| --- | --- |
| PR 头提交 | `4bdd56bb835b4ea88f125a078d3e4e60724d3a9d` |
| 实际被测合并提交 | `6f718a68d3ff4501c9c38afc0db22b737f0db0fb`（合入基点 `caf759ab6ca7603009b7a0c203d29c60ee70bfed`） |
| 平台与运行时 | Ubuntu 24.04.5，Python 3.11.17，pytest 9.1.1，Django 5.0.14 |
| 测试配置 | `backend/pytest.ini`，`DJANGO_SETTINGS_MODULE=config.settings.test`；保留全量范围与 50% 覆盖率门槛 |
| 测试结果 | 收集 923 项：916 passed、3 failed、4 skipped、5 warnings；命令退出码 **1** |
| 覆盖率 | **88.99%**，达到 50% 门槛；整体仍为**失败** |
| 证据 | [后端测试归档](https://github.com/qingxiaoyuan/trace-ship/actions/runs/39224513406/artifacts/12173675031)，保留至 2026-11-02 |

当次工作目录为 `backend/`，实际执行入口如下；报告目录由运行环境步骤写入 `CHECK_REPORT_DIR`，本次值为 `/home/runner/work/_temp/pr-checks/backend-test`。

```bash
set -o pipefail
python -m pytest --junitxml="$CHECK_REPORT_DIR/junit.xml" --cov-report="xml:$CHECK_REPORT_DIR/coverage.xml" 2>&1 | tee "$CHECK_REPORT_DIR/check.log"
```

| 失败节点（相对仓库根目录） | 实际症状 |
| --- | --- |
| `backend/apps/repository/tests/test_branches.py::test_sync_branches_persists_to_db` | 分支同步数量为 1，预期为 2。 |
| `backend/apps/repository/tests/test_branches.py::test_sync_branches_removes_deleted_remote_branch` | 同步后的分支数量为 1，预期为 2。 |
| `backend/apps/repository/tests/test_branches.py::test_sync_branches_skips_stale_branches` | 分支同步数量为 1，预期为 2。 |

三个节点与上述 Windows 基线中的失败一致，已确认跨平台复现。本 PR 与基点的整个 `backend/` Git tree 均为 `c6fd9e4dee1507444833af8e9f798e4bd7dd9305`，业务代码、测试及配置未变；本轮未观测到新增业务测试失败。未在同一 Linux 环境另跑基点，不声称完成了基点与 PR 的独立对照；失败尚未修复。

## 2026-10-19：分支同步测试的时间依赖修复

后续修复见 [#36](https://github.com/qingxiaoyuan/trace-ship/issues/36)。上述三个分支同步失败的根因是测试使用固定的 2026 年 7 月提交日期，却用执行当天计算 90 天陈旧阈值。定点复现为三项失败；仅将同步时钟固定为 2026-07-21，原三项即通过，确认业务过滤规则没有故障。

测试现通过模块内自动清理的固定时钟隔离真实日期，并在 2026 年、闰年 2028 年和 2035 年三个场景中验证：阈值内与恰好 90 天的分支保留，超过阈值一微秒的分支从本地缓存清除，默认分支即使超过 90 天也保留。生产过滤规则、原断言和全量 CI 门槛不变。

Windows / Python 3.12.12 本地定点验证：分支模块 **14 项通过**，仓库模块 **70 项通过**，退出码均为 0。仓库根目录执行命令如下，`--no-cov` 仅表示本次定点行为验证，不替代完整 CI：

```powershell
backend/.venv/Scripts/python.exe -m pytest -c backend/pytest.ini backend/apps/repository/tests/test_branches.py --no-cov -q
backend/.venv/Scripts/python.exe -m pytest -c backend/pytest.ini backend/apps/repository/tests --no-cov -q
```

三个分支同步失败已在上述范围修复；前两节历史失败结果原样保留，其余 Windows 平台失败没有在本次修复。修复提交的完整 Linux CI 结果、被测提交及归档证据统一记录于 #36 及对应 PR，不能以定点结果推定全量通过。

## 2026-10-19：日志与产物读取验收后的 Windows 全量结果

后续验收见 [#26](https://github.com/qingxiaoyuan/trace-ship/issues/26)，基点为 `070556cfe5851af38c94ef40bce9201935196510`。本次相关修复消除了旧日志测试隐式 CRLF 写入造成的五项失败，以及 ZIP MIME 平台推断造成的一项失败。新增真实中文/CRLF 字节读取、维保任务与文件读取权限、过期产物和目录链接隔离回归；历史失败记录继续保留。

Windows / Python 3.12.12 后端全量实测：**946 passed、6 failed、4 skipped、5 warnings，退出码 1**；覆盖率 **86.62%** 达到 50% 门槛，但整体仍为**失败**。实际目录链接测试已执行，没有因权限跳过；原四项跳过保持原状态。仓库根目录执行：

```powershell
$env:PYTHONIOENCODING = 'utf-8'
$env:TEMP = Join-Path (Get-Location) 'tmp/pr-checks/temp'
$env:TMP = $env:TEMP
backend/.venv/Scripts/python.exe -m pytest -c backend/pytest.ini backend --junitxml=tmp/issue26/backend-junit.xml --cov-report=xml:tmp/issue26/backend-coverage.xml *> tmp/issue26/backend-full.log
```

仍失败的节点如下，均已出现在最初的 Windows 基线，本次未修改对应行为：

- `backend/apps/package/tests/test_scm_enhancements.py::TestGitCredentialInjection::test_enabled_injects_askpass_and_identity`
- `backend/apps/package/tests/test_services.py::test_container_package_uses_workspace_and_overrides_env`
- `backend/apps/package/tests/test_services.py::test_custom_script_ec_fails_fast_on_mid_script_error`
- `backend/apps/package/tests/test_services.py::test_run_command_terminates_process_group_when_task_canceled`
- `backend/apps/release/tests/test_source_execution.py::test_cleaned_rc_checkout_preserves_sha_and_stops_before_build_on_drift[False]`
- `backend/apps/release/tests/test_source_execution.py::test_cleaned_rc_checkout_preserves_sha_and_stops_before_build_on_drift[True]`

本地日志和报告位于 `tmp/issue26/`；修复提交的独立 Linux CI 结果与可下载归档记录在 #26 的关联 PR，不以本记录转换或忽略失败。

## 平台与历史证据的边界

PR 后端自动检查使用 Ubuntu 24.04 与 Python 3.11，独立历史全量结果与后续修复分别见上文。Windows 15 项失败与 Linux 3 项失败分别保留，不能互相替代，也不作为后续运行的预期失败名单；三个分支同步节点的修复状态见 #36。

#25 实施期间曾在历史 `master` 观测到 896 passed、相同 15 failed、4 skipped；增加 #25 测试后为 904 passed、相同 15 failed、4 skipped。这只能作为失败早已存在的历史证据，不代表历史检查通过，也不替代本次覆盖率与退出码记录。当时另一份受沙箱临时目录权限影响的日志包含额外失败，不作为本表的业务失败基线。

## 后续更新要求

- 发现新增失败时，单独列出新增节点、被测提交、平台、命令退出码和证据链接，不以存量失败掩盖新增问题。
- 修复本表中的失败后，附对应回归测试和完整检查结果，将该项注明为已修复并保留原记录，不静默删除历史证据。
- 检查因依赖安装、环境或权限问题无法执行时，记录为未完成或执行失败，不填入通过计数。
- 更新平台、运行时、依赖或覆盖率范围后重新测量，注明结果不可直接与旧环境等同。
