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
