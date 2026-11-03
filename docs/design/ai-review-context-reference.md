# AI 审查上下文管理：OpenCode 官方实现参考

本文为 [事项 #93](https://github.com/qingxiaoyuan/trace-ship/issues/93) 提供长期实现参考，区分官方事实、本仓库观察和设计建议。结论是：大文件和大量变更需要分页、独立批次、受限交互及持久化证据配合；上下文压缩只能帮助继续工作，不能证明代码已被完整审查。

## 核查范围与版本

核查日期：2026-11-03。仅使用 OpenCode 官方文档和 `anomalyco/opencode` 官方源码，未安装或运行 OpenCode，未进行真实模型的审查质量评测。

| 对照对象 | 本次固定依据 | 使用边界 |
| --- | --- | --- |
| 发布版 V1 | GitHub `releases/latest` 返回非预发布版 **v1.19.5**，发布于 2026-10-28；Tag 对应提交 `810c0eba1a7348036f8bdf61e6632d0c36c6876c`。 | 下文 V1 源码结论只对应此固定提交，不能概括所有历史版本。依据：[发布页面](https://github.com/anomalyco/opencode/releases/tag/v1.19.5)、[Tag 引用](https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v1.19.5)。 |
| V2 开发实现 | 本次查询 `dev` 得到提交 `1bf08ae46a91f7793c756e4ee521e37b6b554064`，提交时间为 2026-11-02 20:59:03 UTC。 | 下文 V2 源码链接固定到此提交；这是开发分支快照，不能据此声称相同行为已进入某个稳定发行包。依据：[固定提交](https://github.com/anomalyco/opencode/commit/1bf08ae46a91f7793c756e4ee521e37b6b554064)。 |
| V2 官方文档 | `dev.opencode.ai/v2/docs/`，按本次访问内容核对。 | 网页会继续更新；具体实现以本文固定源码为准。文档明确压缩页适用于 V2。依据：[压缩文档](https://dev.opencode.ai/v2/docs/compaction/)。 |

V1 与 V2 配置不能混为一谈：V1 的 `preserve_recent_tokens`、`reserved` 对应 V2 的 `keep.tokens`、`buffer`；V2 不再原生使用 `tail_turns` 和 `prune`，迁移时忽略这两个旧字段并警告。`task` 权限动作也迁移为 `subagent`。依据：[官方迁移说明](https://dev.opencode.ai/v2/docs/migrate-v1/#compaction)。

## 官方实现中可以确认的机制

### 1. 大文件按行读取，单次读取仍有限制

V1 `read` 支持从 1 开始的 `offset` 和 `limit`，默认最多返回 2000 行，同时受 50 KiB 限制。结果带原始行号，并提示下一次读取的偏移；二进制文件被拒绝。单行超过 2000 字符时会截短，所以“已经翻到文件尾”也不能自动证明每个字符都被读取。依据：[V1 read 参数与限制](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/tool/read.ts#L13-L35)、[读取与行号输出](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/tool/read.ts#L137-L179)、[翻页提示](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/tool/read.ts#L327-L350)。

V2 仍采用 2000 行、50 KiB 和单行 2000 字符边界；文本页有 `offset`、`truncated`、`next`，大文本进入分页路径。它不是一次加载整个仓库进模型。依据：[V2 读取与分页实现](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/tool/read-filesystem.ts#L14-L20)、[分页返回结构](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/tool/read-filesystem.ts#L239-L256)、[页大小与长行处理](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/tool/read-filesystem.ts#L292-L328)。

### 2. 工具结果过大时，保留全文并返回有限预览

V1 通用输出截断器默认限制 2000 行或 50 KiB，超限时先保存完整文本，再返回预览及保存路径；提示模型使用搜索、带偏移的读取，或在允许 `task` 时交由 Explore 子代理处理。保存文件按 7 天保留策略清理。这里的“全文”是传入截断器的工具输出，不能由此推断上游工具没有提前截断。依据：[V1 输出截断器](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/tool/truncate.ts#L12-L43)、[落盘与后续读取提示](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/tool/truncate.ts#L125-L140)。

V2 通用处理也将超限文本写入 `tool-output` 目录，返回已展示范围和 `outputPath`；若工具已经提供 `metadata.truncated`，通用处理器会直接沿用该结果。因此保存输出解决的是“可再次读取”，并不等于“已审查”。依据：[V2 工具输出处理](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/tool-output.ts#L69-L119)。

### 3. 子代理把任务放入独立会话，可继续已有任务

V1 `task` 接收独立任务提示，创建关联父会话的子会话；传入 `task_id` 时可继续该子会话。模型使用子代理配置或继承父模型，结果主要返回子会话最后的文本。该提交默认子代理深度上限为 1；后台模式另受实验开关限制。依据：[V1 任务参数](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/tool/task.ts#L50-L70)、[任务执行与子会话](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/tool/task.ts#L92-L225)。

V2 官方文档明确子代理使用新的上下文，在前台或后台子会话运行，并给出禁止编辑及 shell 的只读审查员示例。独立上下文能分散工作量，但父代理仍需安排任务范围、汇总发现和核对缺口。后一条是本文对机制的推论，不是官方完整审查保证。依据：[V2 Agents](https://dev.opencode.ai/v2/docs/agents/#modes)。

### 4. 步数耗尽时收尾；V1 与 V2 的约束强度不同

V1 此提交用 `agent.steps` 判断最后一步，追加 `MAX_STEPS_PROMPT`，要求总结已完成内容、未完成项和下一步；该调用路径仍传入 `tools`，没有在此处设置禁用工具的选择参数。因此仅凭提示词不能声称它具备执行层硬停止。依据：[V1 步数判断与请求](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/session/prompt.ts#L1178-L1285)、[收尾提示](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/core/src/session/runner/max-steps.ts)。

V2 固定源码更严格：到达步数上限后设置 `toolChoice: "none"`，保留工具定义用于缓存；执行层遇到该状态也拒绝实际工具调用。官方文档将用户可见效果概括为最后一步关闭工具并总结。它限制的是继续探索，不保证前面已经完成任务。依据：[V2 最后一步请求](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/runner/llm.ts#L252-L274)、[执行层拒绝](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/runner/step.ts#L94-L104)。

### 5. 历史压缩是有损续接，不是无限上下文

V1 同时存在近期对话保留与旧工具输出裁剪。未显式配置时，近期预算取可用窗口的四分之一，并限制在 2000 至 15000 token 之间；`tail_turns` 可进一步限制选择。启用 `prune` 时，算法保留近期工具输出，扫描超过 40000 token 后的旧结果，待可裁剪量超过 20000 token 才标记压缩，并保护 `skill` 结果。这里是启用条件下的实现，不表示所有配置都开启。依据：[V1 压缩实现](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/session/compaction.ts#L28-L33)、[近期预算](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/session/compaction.ts#L115-L121)、[裁剪算法](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/session/compaction.ts#L273-L318)。

V2 默认开启自动摘要，保留约 15000 token 的近期对话，使用窗口的 15% 作为缓冲；常规窗口至少留 16000 token，过小窗口按比例处理。摘要记录目标、要求、决策、工作状态、下一步及相关文件。源码会结合服务端已报告用量和新增消息估算触发时机。依据：[V2 默认值](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/compaction.ts#L260-L266)、[摘要模板](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/compaction.ts#L166-L205)、[估算和缓冲计算](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/compaction.ts#L1103-L1150)。

“保留近期对话”也不等于保留全部近期原始结果：V2 重建近期文本时会将长工具输出缩到约 1250 个字符，并将附件转为描述。官方文档明确摘要有损，固定指令和工具定义占满窗口时也无法靠压缩获得足够空间。依据：[V2 近期文本转换](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/recent-text.ts#L39-L93)、[压缩限制](https://dev.opencode.ai/v2/docs/compaction/#limits)。

V2 文档描述通常向摘要请求发送当前对话，便于复用缓存；固定源码还存在“移除保留尾部后再摘要”的空间不足分支，不能概括为无条件发送全部历史。若仍超限，还可缩短文本记录或省略旧交流；会话正常请求遇到超限后的自动压缩恢复也只有一次机会。依据：[V2 摘要空间选择](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/compaction.ts#L506-L532)、[有界缩减逻辑](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/compaction.ts#L589-L647)、[一次超限恢复状态](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/runner/llm.ts#L234-L312)、[恢复后关闭再次恢复](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/runner/llm.ts#L370-L373)。

### 6. 输入超限、工具超限、模型输出截断是三件事

工具输出落盘处理的是工具返回过大；摘要处理的是输入上下文增长；模型响应因输出 token 用尽而结束则是另一条路径。V2 对输出上限有继续生成提示，要求将后续工作拆小；连续三次以 `length` 结束后报错，也就是最多容许两次输出超限续接。这不证明一个被截断的 JSON 报告已经有效，也不能用上下文压缩代替结束原因和结构校验。后一条是本仓库结构化审批场景的推论。依据：[V2 输出上限续接提示与处理](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/runner/llm.ts#L37-L41)、[输出上限分支](https://github.com/anomalyco/opencode/blob/1bf08ae46a91f7793c756e4ee521e37b6b554064/packages/core/src/session/runner/llm.ts#L340-L369)。

## 与 Trace Ship 只读审批框架的对照

以下是核查时对工作区 [ai_review_model.py](../../backend/apps/workflow/ai_review_model.py) 的观察；该文件正在随 #93 修改，不代表已合并或已部署状态。

| 当前机制 | 观察及可改进点 |
| --- | --- |
| 固定发布证据 | `_initial_payload` 传入固定 `base/head`；补充文件读取使用 `head_git_hash`。应保留这一约束，不能直接复制通用代理读取移动工作区的行为。 |
| 批次与片段 | `_batch_plan`、`split_diff` 已按容量拆分，`_save_plan` 保存摘要校验与片段引用，`_batch_outcome` 汇总未覆盖片段。它比仅保存对话摘要更适合作为审查覆盖依据。 |
| 受限探索 | 文件清单已有分页；`_context_page` 为 `read` 和指定路径的 `diff` 提供 `offset/limit`、`next_offset` 与总行数，并保留固定 SHA 和原始源码行号。未指定分页且内容足够小时保持原返回形式；单行仍超预算时明确返回缺口。 |
| 收尾 | 最后一次交互或上下文不足时要求 `finish`，收尾状态下不继续执行工具；应继续分别记录“已有有效发现”和“仍有覆盖缺口”。 |
| 有限预算 | 本次观察的 `MAX_INPUT` 是序列化字节边界，另有交互次数、输出 token、响应体大小和时间边界；字节数不等于模型 token 数，任何一项耗尽都可能导致不完整。 |

此次分页发生在取得源码之后，仍受 [GitLab provider](../../backend/utils/provider/gitlab.py) 的 `get_file_raw(max_bytes=65536)` 默认限制：超过 64 KiB 的文件不会因增加分页参数而变为可读。当前实现没有加入工具全文落盘或 V2 自动摘要；跨批、跨片段关联仍是按需探索，不保证穷举。

## 建议迁移的设计原则

本节是结合上述来源提出的本仓库建议，不是 OpenCode 已提供的发布审批能力，也不扩大 #93 的既定实施范围。

1. **先固定证据，再安排模型工作。** 以仓库、`base_sha`、`head_sha`、路径、新旧侧、差异片段范围和内容摘要标识最小单元。模型看到的片段、结果中的定位与后续补读均指向同一快照；清单或内容不完整时保留缺口。
2. **为 `read/diff/search` 提供可续读结果。** 文本读取返回原始行号、实际范围、下一页位置和截断原因；差异分页使用稳定片段标识，保留 unified diff 的原始新旧行号。超长行应支持进一步分段或明确标记未完整读取，不能只翻页后就算完整。搜索命中不替代对未命中区域的检查。
3. **把覆盖账本放在模型上下文之外。** 区分“平台已提供片段”“模型确认审查片段”“片段有未解决读取缺口”。摘要可保存调查方向、符号关系和未完成问题，但不能自行增加已覆盖片段。文件完整覆盖须由其全部必要片段共同满足，不能凭一个 `reviewed_files` 路径推断整文件完整。
4. **给收尾留出可执行预算。** 在追加工具结果之前同时预算下一请求、必要响应和收尾余量；达到阈值后执行层只接受最终报告。以实际 provider 用量校准估算，并继续保留字节和时间上限。不能通过无限增加轮数保证跨文件关系穷举，也不应截掉最终报告后将其标为完成。
5. **让重试恢复固定批次。** 批次标识绑定内容与配置快照；只恢复未完成部分，恢复时验证分区没有重叠或遗漏。已成功批次的发现与证据独立保存，失败重试或摘要替换不清空它们，也不扩大其覆盖范围。
6. **分层压缩并保持只读权限。** 优先缩小工具页、拆批和保存结构化结果；确需摘要时仅压缩可重建的探索历史。固定 SHA、覆盖清单、真实需求标记、权限和待核验事项保持机器可验证记录。无需为此引入任意 shell、代码执行或具备写权限的通用代理。

## 结论与未验证范围

可以借鉴 OpenCode 的分页、超限结果外置、独立任务上下文和强制收尾；不应把“能继续会话”解释成“已经检查全部代码”。官方这些通用机制没有在本文核对范围内给出固定 SHA 发布审查的完整性证明，覆盖证明仍须由 Trace Ship 自己维护。

本次证据限于文档与指定源码路径的静态核对。未验证 OpenCode 运行行为、不同 provider 的 token 估算误差、摘要遗漏率、子代理发现质量或大规模审查吞吐。建议的分页和压缩行为也不因写入本文就成为已交付功能；实际交付以 #93 的代码、测试和验收证据为准。
