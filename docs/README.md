# 文档与事项索引

需求、规格、开发任务与过程记录统一在 GitHub Issues / PR 中维护；仓库保留需要随代码更新的长期文档。事项操作约定见 [Matt 事项管理配置](agents/issue-tracker.md)。

## GitHub 事项

| 事项 | 用途 |
| --- | --- |
| [#5 正式版从已发布 RC 晋升，并支持安全清理 RC Tag](https://github.com/qingxiaoyuan/trace-ship/issues/5) | 规格草稿、验收要求及原需求/PRD 背景 |
| [#6 多个项目复用同一仓库，并共享仓库版本序列](https://github.com/qingxiaoyuan/trace-ship/issues/6) | 规格与现状核验，已注明兼容期方案被 ADR-0021 替代 |
| [#7 维保人员只读查看所属项目的发布和打包信息](https://github.com/qingxiaoyuan/trace-ship/issues/7) | 现行只读规格、权限和移动端范围；操作收权见 [#44](https://github.com/qingxiaoyuan/trace-ship/issues/44) |
| [#8 通过命令面板和详情链接快速定位功能与数据](https://github.com/qingxiaoyuan/trace-ship/issues/8) | 功能规格、设计选择和覆盖核验 |
| [#9 项目发布版本按仓库分组展示](https://github.com/qingxiaoyuan/trace-ship/issues/9) | 版本树规格与已确认设计方向 |
| [#10 初始需求与阶段计划的历史归档](https://github.com/qingxiaoyuan/trace-ship/issues/10) | 历史归档，不作为当前开发任务 |
| [#58 在发布审批中加入可配置技能的 AI 代码审查节点](https://github.com/qingxiaoyuan/trace-ship/issues/58) | 已确认功能规格与八项验收；技能边界见 [ADR-0026](adr/0026-document-based-ai-review-skills.md)，整改闭环见 [ADR-0027](adr/0027-release-review-revision-cycle.md) |

当前进度以对应 Issue 最新正文与评论为准。迁移原文保存在各 Issue 的折叠附录中；归档不意味着验收通过，历史原文不覆盖现行决策。

## 仓库长期文档

| 内容 | 入口 |
| --- | --- |
| 代码审查与交付标准 | [CODING_STANDARDS.md](../CODING_STANDARDS.md) |
| 渲染与交互验收 | [内容、DOM、桌面/手机布局及真实浏览器交互](agents/rendering-acceptance.md) |
| PR 自动检查与失败基线 | [运行时、Linux 后端、PostgreSQL 并发、真实打包、浏览器冒烟及归档](agents/pr-checks.md)、[已知失败记录](agents/check-baselines.md) |
| 领域术语 | [GLOSSARY.md](../GLOSSARY.md) |
| 架构决策 | [ADR 目录](adr/)，RC 晋升决策仍为 proposed |
| 后端架构参考 | [后台设计](design/后台设计.md) |
| 业务流程参考 | [业务流程分析](design/business-process-analysis.md)，历史说明需结合当前代码与 ADR 使用 |
| 节点接入 | [Windows 打包节点](design/package-windows-node.md) |
| 接口 | [接口文档](api/api-spec.md)、[开放接口接入](api/open-api-access.md)、[Postman Collection](api/postman/trace-ship-v1.postman_collection.json) |
| 原型与设计资源 | [overview](ui/overview/)、[desktop](ui/desktop/)、[mobile](ui/mobile/)、[system](ui/system/)、[design-demos](ui/design-demos/) |
