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
    version: '2026.08.11',
    date: '2026-08-11',
    summary: '打包权限收敛与看板易用性增强',
    items: [
      { category: 'feature', text: '打包看板构建列表支持分页（每页 15 条）、关键字搜索与按项目过滤' },
      { category: 'improvement', text: '打包配置参数仅项目管理员 / 软件管理员可维护，其他角色在看板中隐藏编辑入口并显示锁定提示' },
      { category: 'improvement', text: '新建打包配置的项目下拉只列出当前用户可管理（项目管理员 / 软件管理员）的项目' },
      { category: 'improvement', text: '成员记录中的软件管理员角色优先生效，项目负责人被显式设为软件管理员后自动获得对应权限' },
      { category: 'fix', text: '补充项目可见性回归保障：非项目成员无法在项目列表看到该项目，访问详情返回 404' },
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
