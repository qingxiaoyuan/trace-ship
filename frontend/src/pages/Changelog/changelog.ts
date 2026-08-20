/**
 * 系统更新日志数据
 *
 * 每次系统改动随版本发布追加一条记录（最新在最前）：
 * - feature：新功能
 * - improvement：优化改进
 * - fix：问题修复
 */

export type ChangelogCategory = 'feature' | 'improvement' | 'fix';

export interface ChangelogItem {
  category: ChangelogCategory;
  text: string;
}

export interface ChangelogEntry {
  /** 版本标识（无独立版本号时用发布日期） */
  version: string;
  /** 发布日期 YYYY-MM-DD */
  date: string;
  /** 本条更新摘要（可选） */
  summary?: string;
  items: ChangelogItem[];
}

export const changelogEntries: ChangelogEntry[] = [
  {
    version: '2026.08.20',
    date: '2026-08-20',
    summary: '审查体验优化：待整改列表可见、审查关键字高亮、正式版徽标配色调整',
    items: [
      { category: 'improvement', text: '已发布回溯列表默认可只看正式版（类型过滤默认选中「正式」，可手动切换全部/测试/RC），快速聚焦正式发布' },
      { category: 'feature', text: '已发布回溯列表新增「待整改」徽标：存在待整改审查意见的版本在列表直接可见（含待整改条数），无需逐个点进详情确认' },
      { category: 'feature', text: '审查员查看变更文档支持关键字高亮（纯前端）：系统配置页新增「审查关键字高亮」卡片维护关键字（换行/逗号分隔），审查员在变更文档中命中的关键字自动标黄，仅审查员视角生效、不影响文档内容' },
      { category: 'improvement', text: '仓库/项目详情的发布版本列表中，正式版徽标由黑色调整为靛蓝色，与移动端配色一致' },
      { category: 'improvement', text: '部署脚本 deploy.sh 移除「清理环境」与「清空 LDAP 用户」入口；已部署过的环境引导菜单不再显示「第一次部署」选项，避免误操作' },
    ],
  },
  {
    version: '2026.08.20',
    date: '2026-08-20',
    summary: '修复更新内容扫描问题，仓库详情支持标签删除与发布版本查看',
    items: [
      { category: 'fix', text: '修复自动扫描更新内容时 `<feat>`/`feat:` 类提交的变更条目残留 A/F 前缀的问题，扫描结果只保留纯内容，类型由系统单独标记' },
      { category: 'fix', text: '修复 `<feat>`/`<fix>` 块不在提交信息首行时（如标准模板「更新内容：」段落内）整块更新内容扫描不到的问题，现支持任意位置识别且多个 `<feat>`/`<fix>` 块可混合解析、类型各自独立' },
      { category: 'feature', text: '仓库详情「标签」支持删除：点击标签卡片删除按钮后需输入完整 Tag 名称二次确认，删除远程 Tag 并同步清理本地缓存（不可恢复，仅项目管理员可操作；远程 Tag 已不存在时幂等成功）' },
      { category: 'feature', text: '仓库详情新增「发布版本」Tab：查看该仓库由系统发布的全部版本（版本号/Tag/发布类型/发布人/发布时间），支持搜索并点击跳转发布详情' },
    ],
  },
  {
    version: '2026.08.18',
    date: '2026-08-18',
    summary: '发布创建时可勾选「发布后自动打包」配置，仅触发勾选的配置',
    items: [
      { category: 'feature', text: '创建发布时自动列出该仓库启用「发布后自动打包」的打包配置，支持逐条勾选（默认全选，可一键全选/全不选），审批通过并推 Tag 成功后仅触发勾选的配置；未勾选任何配置则本次发布不自动打包' },
      { category: 'improvement', text: '勾选结果按创建时快照固定：之后新增或启用的自动打包配置不会自动加入本次发布，行为可预期、便于追溯' },
      { category: 'improvement', text: '发布创建时更新内容默认只自动填入前 10 条，其余已解析条目通过「检测commit」弹窗勾选添加（支持一键全选/清空、可编辑内容，重复条目自动去重），commit 和 MR 过多时更新内容区不再难以处理' },
    ],
  },
  {
    version: '2026.08.18',
    date: '2026-08-18',
    summary: '发布版本详情增强：提交区间展示 + 发布文档审查整改闭环',
    items: [
      { category: 'feature', text: '发布详情页新增「提交记录」Tab：展示「上一 tag -> 本次发布 tag」区间内已保存的提交快照（哈希/作者/内容/时间/审查状态/是否纳入说明），基线 tag 随发布说明生成时快照固定，历史版本显示首个版本区间' },
      { category: 'feature', text: '发布详情页新增「审查整改」Tab：系统审查员可对已发布版本的发布文档逐条发起整改意见并推送站内通知给发布人；发布人修改发布文档后逐条回复；审查员对每条意见独立判定通过/驳回，驳回可填备注，发布人可多轮修改再回复，全部通过即整改完成' },
    ],
  },
  {
    version: '2026.08.17',
    date: '2026-08-17',
    summary: '打包看板支持项目过滤与本地记忆、支持按仓库分支最新代码直打包',
    items: [
      { category: 'feature', text: '打包看板新增「按分支最新代码」打包方式：选择打包配置与仓库分支后，直接对该分支最新代码打包（无需发布流程），任务标题与自动编码（版本号）均按分支名命名，任务记录同时保存分支最新提交哈希便于追溯' },
      { category: 'feature', text: '分支直打包任务完成或失败时向触发人发送站内通知（无关联发布时不再依赖发布人）' },
      { category: 'improvement', text: '分支直打包与发布流程解耦：不依赖已发布版本、不会触发「发布后自动打包」；无发布说明时克隆源码跳过发布说明写入，分支名含斜杠等特殊字符时自动做路径安全处理' },
      { category: 'improvement', text: '打包看板的构建列表与打包配置列表支持按项目过滤（默认全部项目），选择过的项目写入本地缓存，下次进入自动复用' },
      { category: 'fix', text: '修复分支直打包 SVN 推送失败：分支名含斜杠时版本目录的父目录不存在（svn import 不会自动创建），推送前自动逐级创建缺失的父目录' },
      { category: 'improvement', text: '分支直打包任务在打包看板/详情中明确标注「分支」来源并显示最新提交短哈希，与按 Tag 触发的任务清晰区分' },
      { category: 'improvement', text: '新建打包弹窗的「按已发布 Tag / 按分支最新代码」切换改为与打包看板一致的分段样式' },
      { category: 'improvement', text: '发布变更预览单分支最大提交扫描数默认限制为 10 条（RELEASE_PREVIEW_MAX_COMMITS 可配置）；超出该范围时回退区间对比，变更内容仍完整' },
      { category: 'improvement', text: '生成发布说明接口前端超时由 30 秒放宽至 5 分钟，内容较多时不再超时失败' },
      { category: 'improvement', text: '发布看板不再展示草稿状态（草稿为内部过程状态），看板/列表聚焦待审批、已发布、已驳回' },
      { category: 'improvement', text: '顶部通知入口由红点改为数字徽标，未读数量一目了然（超过 99 显示 99+）' },
      { category: 'improvement', text: '生成发布说明文档时，将「配置项改动」置于「变更类型」下方、便于先确认配置影响' },
      { category: 'fix', text: '修复发布说明「变更内容」等多行单元格只显示第一行的问题：提交审查页与发布详情页现可正确按换行展示每一条变更，变更类型（A/F）标记逐行生效' },
      { category: 'fix', text: '修复脚本编辑器在高 DPI / 窗口缩放下光标错位的问题：开启固定行号栏宽度、补齐等宽字体兜底，并在容器尺寸变化时同步 Ace 渲染层' },
      { category: 'improvement', text: '从 Windows 粘贴到 sh 脚本编辑器的命令自动将 CRLF 转换为 LF，避免行尾回车符影响 shell 执行' },
    ],
  },
  {
    version: '2026.08.14',
    date: '2026-08-14',
    summary: 'AI 打包脚本助手（Beta）上线，发布版本支持删除',
    items: [
      { category: 'feature', text: '已发布版本支持删除：发布详情页对「已发布」状态提供「删除版本」入口，二次确认需输入完整 Tag 名称后执行，同时删除远端 Tag、发布记录及关联打包任务（操作不可恢复，仅项目管理员可操作）' },
      { category: 'feature', text: '发布草稿与已驳回记录支持删除：详情页提供删除入口并二次确认；草稿可由创建人或项目管理员删除，已驳回记录需项目管理员' },
      { category: 'feature', text: '打包配置新增「AI 生成脚本」按钮（Beta）：按平台执行约定、仓库结构、本地 Docker 镜像/远程 Windows 节点工具探测结果生成打包脚本草稿，逐行解释每一条命令，确认后可应用到脚本编辑器；支持 OpenAI / Anthropic 兼容服务，在系统配置页维护 AI 服务参数' },
      { category: 'feature', text: '新增「AI 打包知识库」：在系统配置页录入通用打包规范与注意事项，AI 生成脚本时自动作为上下文注入' },
      { category: 'feature', text: '生成时可参考平台内历史打包成功的脚本（同项目优先、跨项目兜底，按相关度与成功次数排序），默认开启可随时关闭' },
      { category: 'improvement', text: '远程 Windows 节点生成前自动探测工具链（where + --version），未探测到的工具不假定存在；仓库扫描 / 容器探测 / 节点探测失败仅提示警告，不阻断生成' },
      { category: 'improvement', text: 'AI 生成结果始终为草稿：不自动保存、不自动执行，需人工核对后保存配置；历史脚本中的明文凭据在注入前自动脱敏' },
    ],
  },
  {
    version: '2026.08.13',
    date: '2026-08-13',
    summary: '发布预览基线优化与构建产物自动压缩',
    items: [
      { category: 'feature', text: '打包配置新增「自动压缩产物」开关：构建完成后将产物目录内所有内容压缩为单个 zip 压缩包（命名：打包配置名-版本-日期），最终产物只保留一个压缩包，本地 Docker 与远程 Windows 节点行为一致' },
      { category: 'feature', text: '发布变更预览按发布类型（正式/RC/测试）分别取对应类型的最新 Tag 作为基线，RC/测试版预览不再混用正式版基线' },
      { category: 'feature', text: '项目列表返回当前用户有效角色（my_role），打包配置项目下拉仅列出可管理的项目' },
      { category: 'improvement', text: '变更预览并行拉取 Tag 与提交、Tag 列表 60 秒短缓存并在推 Tag 后自动失效，预览与版本号计算更及时；回退 compare 前先校验 Tag 是否为分支祖先，避免跨分支 Tag 被误当基线' },
      { category: 'improvement', text: '新增「发布预览单分支最大提交扫描数」配置（RELEASE_PREVIEW_MAX_COMMITS，默认 100）' },
      { category: 'improvement', text: '仓库列表优先显示完整克隆地址，编辑仓库时回填全地址；项目详情仓库表格调整列宽（地址列加宽、操作栏加宽、同步时间不换行）' },
      { category: 'improvement', text: '健康检查结果短缓存 5 秒，降低高频探针对数据库/Redis 的压力' },
      { category: 'improvement', text: '后端引入 Ruff 统一代码检查与格式化工具链' },
      { category: 'fix', text: '修复变更预览并发复用 GitLab HTTP 会话的线程安全隐患（加锁串行化）' },
    ],
  },
  {
    version: '2026.08.12',
    date: '2026-08-12',
    summary: '远程打包调试能力与发布说明传递增强',
    items: [
      { category: 'feature', text: '远程 Windows 打包新增「打包后清理工作区」开关（默认开启），关闭后保留完整工作目录（源码/产物/临时文件）供调试排查' },
      { category: 'feature', text: '发布说明随源码保存：打包时自动写入 release-{版本}.md 并通过 RELEASE_DOC_PATH 环境变量传递给构建脚本，本地 Docker 与远程 Windows 均生效' },
      { category: 'improvement', text: '打包配置的自动收集产物等选项改为开关卡片形式，配置可见性与操作体验提升' },
    ],
  },
  {
    version: '2026.08.11',
    date: '2026-08-11',
    summary: '打包权限收敛与看板易用性增强',
    items: [
      { category: 'feature', text: '打包看板构建列表支持分页（每页 15 条）、关键字搜索与按项目过滤' },
      { category: 'feature', text: '打包任务区分发布类型：任务带正式/RC/测试徽标，SVN 推送目录默认对 RC/测试版追加类型后缀，模板支持 {release_type} 占位符' },
      { category: 'feature', text: '远程 Windows 节点支持最大并发数配置，超出并发的任务排队等待（等待节点状态可见）而不是失败' },
      { category: 'feature', text: '远程 Windows 节点支持 CPU 资源限制：构建可用核数（亲和性）与进程优先级可配，防止打包占满 CPU 导致 SSH 断连' },
      { category: 'feature', text: '打包配置级资源限制：核数/优先级可覆盖节点默认，支持内存上限（作业对象硬限制，超限进程树被约束）' },
      { category: 'feature', text: '打包配置新增「自动收集产物」开关：勾选后构建完成自动把产物目录内容归集到 artifacts，脚本无需手动拷贝' },
      { category: 'improvement', text: '大日志优化：构建日志虚拟滚动渲染、首屏只加载末尾 256KB、轮询增量追加，支持下载完整日志' },
      { category: 'improvement', text: '打包配置参数仅项目管理员 / 软件管理员可维护，其他角色在看板中隐藏编辑入口并显示锁定提示' },
      { category: 'improvement', text: '新建打包配置的项目下拉只列出当前用户可管理（项目管理员 / 软件管理员）的项目' },
      { category: 'improvement', text: '成员记录中的软件管理员角色优先生效，项目负责人被显式设为软件管理员后自动获得对应权限' },
      { category: 'fix', text: '补充项目可见性回归保障：非项目成员无法在项目列表看到该项目，访问详情返回 404' },
      { category: 'fix', text: '修复发布关联提交接口因过滤器模型不匹配导致的 500 错误' },
      { category: 'fix', text: '修复软件管理员无法创建/修改发布的问题（角色校验遗漏 software_admin）' },
      { category: 'fix', text: '导出与推送 SVN 的发布说明 MD 文件改用标准表格语法（单元格内换行转换为 <br>）' },
    ],
  },
  {
    version: '2026.08.10',
    date: '2026-08-10',
    summary: '打包能力扩展：支持远程 Windows 节点打包，审批信息更完整',
    items: [
      { category: 'feature', text: '打包支持远程 Windows 节点：系统级节点池（系统配置页维护），SSH 执行脚本、SFTP 回传产物，支持连接测试' },
      { category: 'feature', text: '打包配置弹窗全新改版：脚本编辑器支持 bat/sh 语法高亮、变量一键插入、全屏放大编辑' },
      { category: 'feature', text: '审批详情页新增发布分支 Git Hash 展示与变更文档（发布说明）查看卡片' },
      { category: 'feature', text: '凭证新增 Windows 密码类型（全系统共享），用于远程节点登录' },
      { category: 'improvement', text: '远程打包日志实时回写，支持任务取消、节点输出 GBK 编码兼容' },
      { category: 'improvement', text: '前端开发端口调整为 8855' },
      { category: 'fix', text: '修复 Windows 节点克隆时报 unable to persist credentials（wincredman 凭据持久化失败）' },
      { category: 'fix', text: '修复凭证 URL 编码被 cmd 环境变量展开破坏导致的远程克隆认证失败，改用 Authorization 头认证' },
      { category: 'fix', text: '修复删除仍被引用的打包节点导致配置悬空的问题（删除时拦截并提示）' },
    ],
  },
  {
    version: '2026.08.05',
    date: '2026-08-05',
    summary: '权限细化与审查能力增强',
    items: [
      { category: 'feature', text: '系统管理权限细化为用户/角色/配置/打包镜像/日志独立权限点，新增软件管理员角色' },
      { category: 'feature', text: '提交规范审查支持自定义版本区间与版本日期开关' },
      { category: 'feature', text: '规范提交插件支持合并冲突解决（内联 CodeLens 与原生合并编辑器两种模式）' },
      { category: 'improvement', text: '重构项目角色权限模型，统一项目资源可见性与操作权限' },
      { category: 'improvement', text: '规范提交插件支持多仓库/子模块场景，按仓库分组暂存与提交' },
      { category: 'fix', text: '修复版本号计算在无日期的历史 tag 场景下的计算错误' },
    ],
  },
  {
    version: '2026.07.20',
    date: '2026-07-20',
    summary: '使用反馈与基础体验完善',
    items: [
      { category: 'feature', text: '新增使用反馈模块：全员可提交/点赞/查看，超管可标记已处理' },
      { category: 'feature', text: '新增使用说明页与浏览器升级引导页' },
      { category: 'improvement', text: '管理员密码丢失可通过管理命令恢复（reset_admin_password）' },
    ],
  },
  {
    version: '2026.07.02',
    date: '2026-07-02',
    summary: 'Jenkins 下线，内置打包上线',
    items: [
      { category: 'feature', text: '打包能力内置化：本地 Docker 镜像打包、产物下载、SVN 推送，发布后自动触发' },
      { category: 'feature', text: '发布主流程调整为审批通过后推送 Git Tag，打包结果不再回滚发布状态' },
      { category: 'improvement', text: 'Jenkins 模块整体下线，仅保留迁移 tombstone' },
    ],
  },
];

export const categoryMeta: Record<ChangelogCategory, { label: string; badge: string; dot: string }> = {
  feature: {
    label: '新功能',
    badge: 'border-indigo-200 bg-indigo-50 text-indigo-600',
    dot: 'bg-indigo-500',
  },
  improvement: {
    label: '优化改进',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-600',
    dot: 'bg-emerald-500',
  },
  fix: {
    label: '问题修复',
    badge: 'border-rose-200 bg-rose-50 text-rose-600',
    dot: 'bg-rose-500',
  },
};
