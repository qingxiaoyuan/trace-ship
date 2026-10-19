# PR 自动检查

质量检查定义在 [pr-checks.yml](../../.github/workflows/pr-checks.yml)，执行命令以工作流及前后端配置为准。面向 `master` 的 PR、合入 `master` 的推送及手动触发均执行同一组检查。

## 检查与运行环境

| 检查名称 | 使用的已有入口 | 环境 |
| --- | --- | --- |
| 前端 / lint | `frontend/package.json` 的 `lint` | Ubuntu 24.04、Node.js 24 |
| 前端 / test | `test`，执行全量 Vitest，补充 JUnit 输出 | Ubuntu 24.04、Node.js 24 |
| 前端 / build | `build`，包含 `tsc -b` 与 Vite 构建 | Ubuntu 24.04、Node.js 24 |
| 后端 / lint | `backend/pyproject.toml` 的 Ruff 规则 | Ubuntu 24.04、Python 3.11 |
| 后端 / test | `backend/pytest.ini` 的全量 pytest 与覆盖率门槛 | Ubuntu 24.04、Python 3.11 |

检查独立运行；矩阵关闭提前终止，一项失败不会取消其他检查。每项保留命令真实退出状态，日志管道使用 `pipefail`。已知失败不跳过、不标记预期失败，也不使用 `continue-on-error` 将检查转为绿色。

后端使用内存 SQLite、本地缓存与 Celery eager 测试配置，不启动业务 PostgreSQL、Redis、GitLab 或使用真实业务凭证。完整安装开发依赖；`python-ldap` 所需系统库在工作流中显式安装。Python 3.11 与后端容器目标保持一致，本地其他版本的结果单独记录。

前端沿用仓库当前不跟踪锁文件的约定，以 `npm install --no-package-lock` 安装；关闭依赖锁文件的 npm 缓存。该方式允许依赖范围内更新，因此报告保留实际依赖树，跨运行比较时应同时核对版本。引入并维护锁文件属于后续独立改进。

工作流使用 `pull_request` 事件、只读仓库权限和固定提交的官方 Actions，不向被测代码提供写入凭证。上传日志使用 Actions 自身的运行时能力。此变更只定义检查，不更改仓库分支保护；需要强制合入门槛时，可在仓库规则中按上表选择所需检查。

## 证据与结论

每个检查的运行汇总分别显示依赖安装和检查步骤的实际结果。依赖安装或环境失败时，检查可能未执行，这不代表通过。取消、跳过和失败分别保留原状态。

每个矩阵任务都在成功或失败后尝试上传独立证据包，名称包含检查类型与重试次数，保留 14 天：

- 被测提交、操作系统与运行时版本。
- 依赖安装日志和实际依赖版本。
- 检查原始输出；测试任务另含 JUnit，后端测试另含覆盖率 XML。

工作流尚未发布或首次运行尚未结束时，远端检查保持**待验证**；本地验证和语法校验不能替代 GitHub runner 的真实执行。依赖安装、报告上传等失败也按实际结果处理。

所有测试断言通过且覆盖率达到现有门槛，后端测试才可记为通过。覆盖率达标但仍有失败断言时，整体仍为失败。[已知失败基线](check-baselines.md)用于归因与比较，不参与退出码计算；更新基线时保留平台、提交、命令及证据。

## 本地复核

在对应目录使用现有 `package.json` 脚本或 Ruff/pytest 配置复核，保持工作流相同的全量范围。保存测试报告时沿用工作流参数，将报告路径改为本机可写目录，并记录命令退出码。

只验证某个后端行为时，可显式使用 `pytest --no-cov <测试路径或节点>`，将结果标为定点行为验证。它不替代全量检查，也不构成全项目覆盖率通过的证据；全量 PR 检查继续保留 `pytest.ini` 的 50% 门槛。

Windows 受限环境中若 Vitest 临时文件重命名出现 `EPERM`，可只为本次子进程设置指向仓库内可写临时目录的 `TEMP` / `TMP`，并在报告中注明。不同平台结果分别记录，不将 Windows 基线套用到 Linux。

渲染类变更还须满足[渲染验收](rendering-acceptance.md)中的内容、DOM 与真实浏览器布局证据；CI 的 jsdom 测试和构建结果不能单独证明桌面或手机排版正确。

参考：[GitHub 工作流结果上下文](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)、[setup-node 缓存约定](https://github.com/actions/setup-node#caching-global-packages-data)、[报告上传](https://github.com/actions/upload-artifact)。
