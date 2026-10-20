# PR 自动检查

质量检查定义在 [pr-checks.yml](../../.github/workflows/pr-checks.yml)，执行命令以工作流及前后端配置为准。面向 `master` 的 PR、合入 `master` 的推送及手动触发均执行同一组检查。

## 检查与运行环境

| 检查名称 | 使用的已有入口 | 环境 |
| --- | --- | --- |
| 前端 / lint | `lint` 及 `test:runtime` 的运行时入口回归 | Ubuntu 24.04，Node 版本取 `frontend/.node-version` |
| 前端 / test | `test`，执行全量 Vitest，补充 JUnit 输出 | 同上 |
| 前端 / build | `build`，包含 `tsc -b` 与 Vite 构建 | 同上 |
| 后端 / lint | `scripts/checks/backend-linux.py lint`，执行已有 Ruff 规则 | 本地与 CI 共用 `docker/checks/Dockerfile` 的 Linux/Python 3.11 镜像 |
| 后端 / test | `scripts/checks/backend-linux.py test`，执行全量 pytest 与覆盖率门槛 | 同上 |
| 浏览器 / 冒烟验收 | `test:browser`，真实 Chromium、完整前端及隔离 REST 服务 | Ubuntu 24.04、精确前端运行时、Python 3.11 |

检查独立运行；矩阵关闭提前终止，一项失败不会取消其他检查。每项保留命令真实退出状态，日志管道使用 `pipefail`。已知失败不跳过、不标记预期失败，也不使用 `continue-on-error` 将检查转为绿色。

后端使用内存 SQLite、本地缓存与 Celery eager 测试配置，不启动业务 PostgreSQL、Redis、GitLab 或使用真实业务凭证。检查镜像完整安装开发依赖与 LDAP/SASL 系统库，源码只读挂载，运行检查时关闭网络；可写目录仅用于测试临时数据与报告。GitHub runner 为 Ubuntu，实际测试在镜像内执行，报告记录容器发行版与 Python 版本。Python 其他版本的结果单独记录。

前端跟踪 `frontend/package-lock.json`，本地和 CI 均以 `npm ci` 安装。Node 精确版本以 `frontend/.node-version` 为准，npm 精确版本以 `package.json` 的 `packageManager` 为准；安装、开发和检查入口共同校验实际运行时，版本不符时失败。`.npmrc` 的 engine-strict 同时拒绝不支持的依赖组合。更新依赖时使用受约定的运行时修改清单与锁文件，并执行完整检查；普通复核不重写锁文件。报告继续保留实际依赖树，跨平台的可选原生包差异按实际记录。

前端镜像同样使用 npm 锁文件与运行时守卫；修改 Node 版本时同步调整 Dockerfile 的基础镜像，安装阶段会拒绝镜像版本与 `.node-version` 不一致。`docker/package/web/` 是业务打包镜像，其 pnpm 入口服务于被打包项目，不属于本仓库前端开发环境。

工作流使用 `pull_request` 事件、只读仓库权限和固定提交的官方 Actions，不向被测代码提供写入凭证。上传日志使用 Actions 自身的运行时能力。此变更只定义检查，不更改仓库分支保护；需要强制合入门槛时，可在仓库规则中按上表选择所需检查。

## 证据与结论

每个检查的运行汇总分别显示依赖安装和检查步骤的实际结果。依赖安装或环境失败时，检查可能未执行，这不代表通过。取消、跳过和失败分别保留原状态。

前后端矩阵任务都在成功或失败后尝试上传独立证据包，名称包含检查类型与重试次数，保留 14 天；浏览器证据保留 30 天：

- 被测提交、操作系统与运行时版本。
- 依赖安装日志和实际依赖版本。
- 检查原始输出；测试任务另含 JUnit，后端测试另含覆盖率 XML。
- 浏览器报告、实际视口截图和交互/下载校验，失败时保留失败信息；临时数据库、令牌、用户密码与完整浏览器存储不作为附件。

工作流尚未发布或首次运行尚未结束时，远端检查保持**待验证**；本地验证和语法校验不能替代 GitHub runner 的真实执行。依赖安装、报告上传等失败也按实际结果处理。

所有测试断言通过且覆盖率达到现有门槛，后端测试才可记为通过。覆盖率达标但仍有失败断言时，整体仍为失败。[已知失败基线](check-baselines.md)用于归因与比较，不参与退出码计算；更新基线时保留平台、提交、命令及证据。

## 本地复核

在对应目录使用现有 `package.json` 脚本或 Ruff/pytest 配置复核，保持工作流相同的全量范围。保存测试报告时沿用工作流参数，将报告路径改为本机可写目录，并记录命令退出码。

### 前端与运行时

先按 `frontend/.node-version` 和 `packageManager` 准备 Node/npm，在 `frontend/` 执行：

```bash
npm ci
npm run test:runtime
npm run lint
npm run test
npm run build
```

### Linux 后端

安装并启动 Docker（支持 Compose），在仓库根目录执行；启动包装器只依赖宿主 Python 标准库，宿主无需安装业务依赖：

```bash
python scripts/checks/backend-linux.py all --report-dir tmp/pr-checks/backend-linux
```

`lint` / `test` 可单独运行。包装器构建检查镜像，再调用共享的 `backend.py`；`all` 即使 lint 失败也继续测试，最终仍返回失败。每次使用新的报告目录，避免将上次结果当作本次证据。镜像构建需要下载依赖，测试容器不联网；不启动应用编排或业务依赖。

默认从官方 PyPI 安装。若本机到官方源出现已核实的网络失败，可显式追加 `--package-index https://pypi.tuna.tsinghua.edu.cn/simple`，使用入口允许的公开 HTTPS 镜像；实际来源与镜像身份写入报告。该次本地结果只证明所记录的来源和环境，不能代替官方源的远端 CI。入口拒绝私有索引及带凭据地址，错误信息不回显传入 URL。

已有 Linux/Python 3.11 开发环境也可直接执行 `python scripts/checks/backend.py lint|test --report-dir <目录>`。共享入口强制使用测试配置，拒绝其他 Python 版本，保留完整 pytest 配置与真实退出码。CI 与本地容器共用 Dockerfile；Python 依赖仍按现有 requirements 范围安装，实际版本在报告归档，不声称已锁定全部后端依赖。

### 真实浏览器冒烟

先按后端开发约定安装 Python 依赖，前端执行过 `npm ci`，再在 `frontend/` 执行：

```bash
npx playwright install chromium
npm run test:browser
```

Linux 首次安装浏览器还需 `npx playwright install --with-deps chromium`。`CHECK_PYTHON` 可指定已安装后端依赖的 Python 可执行文件，默认 `python`；例如 PowerShell 在根目录设置 `$env:CHECK_PYTHON = (Resolve-Path backend/.venv/Scripts/python.exe).Path`。`CHECK_REPORT_DIR` 指定报告根目录，默认 `tmp/pr-checks/browser`，每次在其中创建独立运行子目录。

入口创建独立 SQLite 与虚构数据，选择临时 loopback 端口并校验本次服务身份，使用前端生产构建及独立预览服务执行浏览器检查，最后停止服务并清理含凭据的数据。覆盖持久会话下任务直达/刷新路径与 query、中文长日志尾部和增量、完整日志原字节、单文件和嵌套 ZIP、缺失日志及过期产物。发布补打另覆盖桌面「发布详情 → 已有配置 → 新任务」、固定身份/实际操作人/手动不推 SVN、摘要刷新和 375px 隐藏入口。远端 Tag 查询使用固定样本，外部任务投递只保存任务回执；HTTP、授权、任务创建、源码引用校验与审计使用生产实现。该冒烟不连接远端仓库，也不执行真实业务打包任务。

报告保留被测提交及未提交状态、系统/运行时/浏览器版本、实际视口、样本摘要、逐步结果、截图和清理结果。Issue/PR 附对应运行及归档链接，注明保留期限；需要长期保留时在到期前另行归档。CI 新增浏览器 job 只证明已执行的交互，不能替代[渲染验收](rendering-acceptance.md)要求的人工布局与适用的手机验收。

只验证某个后端行为时，可显式使用 `pytest --no-cov <测试路径或节点>`，将结果标为定点行为验证。它不替代全量检查，也不构成全项目覆盖率通过的证据；全量 PR 检查继续保留 `pytest.ini` 的 50% 门槛。

Windows 受限环境中若 Vitest 临时文件重命名出现 `EPERM`，可只为本次子进程设置指向仓库内可写临时目录的 `TEMP` / `TMP`，并在报告中注明。不同平台结果分别记录，不将 Windows 基线套用到 Linux。

渲染类变更还须满足[渲染验收](rendering-acceptance.md)中的内容、DOM 与真实浏览器布局证据；CI 的 jsdom 测试和构建结果不能单独证明桌面或手机排版正确。

参考：[GitHub 工作流结果上下文](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)、[setup-node 缓存约定](https://github.com/actions/setup-node#caching-global-packages-data)、[报告上传](https://github.com/actions/upload-artifact)。
