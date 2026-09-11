import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  Boxes,
  CircleCheck,
  CircleHelp,
  FileText,
  FolderKanban,
  GitFork,
  GitPullRequestArrow,
  Hammer,
  KeyRound,
  Rocket,
  ScanSearch,
  Settings,
  ShieldCheck,
  Tag,
  Users,
} from 'lucide-react';

interface StepItem {
  title: string;
  desc: string;
}

interface GuideSection {
  id: string;
  title: string;
  icon: typeof BookOpen;
  iconClass: string;
  intro?: string;
  steps?: StepItem[];
  bullets?: string[];
  tips?: string[];
}

const sections: GuideSection[] = [
  {
    id: 'quick-start',
    title: '快速上手',
    icon: Rocket,
    iconClass: 'icon-indigo',
    intro: 'Trace Ship 以「产品关联仓库」组织发布管理：产品用于成员、权限、审批和构建配置；仓库是软件与版本的最小单位。第一次使用可按以下步骤完成一次发布。',
    steps: [
      { title: '创建产品', desc: '在「产品」页新建产品，设置产品负责人和成员。' },
      { title: '登记仓库', desc: '在「仓库」页登记 GitLab 软件仓库。登记仓库不要求绑定产品；同一仓库只需登记一次。系统会为该仓库生成正式 / RC / Beta 三套发布审批流程，仓库创建者可在仓库详情的「审批流」中编辑。' },
      { title: '关联仓库', desc: '在产品详情的「软件仓库」页关联已有仓库，并设置默认分支和源码子目录等当前产品设置。' },
      { title: '准备凭证与打包（可选）', desc: '在「凭证」页维护 GitLab Token、SVN 账号等凭证，并按仓库、产品与操作范围配置借用授权；需要构建时在关联仓库下维护打包配置。' },
      { title: '发起仓库发布', desc: '在「新建发布」页选择产品和一个已关联仓库，再选择分支。系统按仓库 Tag 与版本规则计算版本，审批通过后只为该仓库推送一个 Tag。' },
    ],
  },
  {
    id: 'release-flow',
    title: '发布流程详解',
    icon: Tag,
    iconClass: 'icon-cyan',
    intro: '发布是系统的核心流程，状态依次为：草稿 → 待审批 → 已发布 / 已驳回。',
    steps: [
      { title: '创建发布申请', desc: '选择产品、一个已关联仓库与目标分支；未手动填写版本号时，系统会基于该仓库已有 Tag 和仓库版本规则自动计算。' },
      { title: '预览变更', desc: '系统自动拉取上个 Tag 到目标分支之间的提交与合并请求，并解析新增（A）/ 修复（F）类更新内容，确认无误后继续。' },
      { title: '撰写发布说明', desc: '在发布详情页生成并编辑 Markdown 发布说明，发布说明非空才能提交审批。' },
      { title: '提交审批', desc: '按仓库与发布类型匹配启用的审批流程。正式发布默认需仓库拥有者审批；RC / Beta 默认无须审批，提交后直接推 Tag。' },
      { title: '审批流转', desc: '审批人在「审批中心」处理任务，支持通过、驳回、转交、回退；回退到初始节点时发布可恢复为草稿重新编辑。' },
      { title: '发布完成', desc: '审批全部通过后系统自动向仓库推送 Tag，推送成功发布状态变为「已发布」；失败则标记为「已驳回」并记录原因。' },
      { title: '自动打包', desc: '推 Tag 成功后，仅本次产品与仓库关联下开启「发布后自动打包」的配置会创建打包任务；打包异常不影响发布状态。' },
    ],
    tips: ['发布申请在「草稿」状态下可随时修改或删除；提交审批后如需修改，可让审批人回退到初始节点。'],
  },
  {
    id: 'roles',
    title: '按角色使用指引',
    icon: Users,
    iconClass: 'icon-violet',
    intro: '产品成员分为开发、测试、产品管理员、审核人、只读等角色，系统管理员负责平台级配置。',
    bullets: [
      '开发人员：关注「提交审查」中自己提交的合规情况，按提交规范书写 Commit Message；需要发布时向产品管理员提出申请。',
      '测试人员：在发布详情中查看本次仓库发布的变更清单与关联提交，验证发布后的软件行为。',
      '产品管理员：维护产品信息、成员、关联仓库与打包配置，发起发布申请并跟进审批进度。仓库审批流由仓库创建者在仓库详情中维护。',
      '审批人：在「审批中心」处理待办任务，审批前重点核对发布说明、变更清单与关联提交；支持转交他人或回退给申请人。',
      '系统管理员：在「系统管理」中维护用户、角色、系统参数、打包镜像与 Nexus 连接，并通过「操作日志」审计平台行为。',
    ],
  },
  {
    id: 'package',
    title: '打包与镜像',
    icon: Hammer,
    iconClass: 'icon-amber',
    intro: '打包统一由「打包」模块执行，镜像可来自本地 Docker 或 Nexus 仓库。',
    steps: [
      { title: '准备镜像', desc: '在「系统管理 → 打包镜像」页查看本地与 Nexus 镜像列表，支持上传 tar 包导入本地镜像。镜像需包含 /workspace/scripts/pack.sh 入口脚本。' },
      { title: '仓库打包配置', desc: '产品管理员在产品详情的「打包配置」中选择软件仓库与镜像（按坐标自动建档），配置构建目录、产物目录、环境变量，可选自定义脚本与 SVN 推送。' },
      { title: '执行打包', desc: '在「打包看板」手动触发或由发布自动触发。系统会克隆源码到工作区，仅挂载源码、产物、临时目录进容器执行打包。' },
      { title: '查看结果', desc: '打包任务状态为排队 / 运行中 / 成功 / 失败 / 已取消，可查看完整日志、产物清单与 SVN 推送结果。' },
    ],
    tips: [
      '自定义脚本优先于镜像内置入口脚本执行，容器内统一使用 /bin/sh。',
      '产物需输出到 /workspace/artifacts 目录才会被平台收集与推送。',
    ],
  },
  {
    id: 'commit-review',
    title: '提交规范审查',
    icon: ScanSearch,
    iconClass: 'icon-rose',
    intro: '系统会持续同步仓库提交并按照提交规范自动审查，帮助团队保持一致的提交质量。',
    bullets: [
      '在「提交审查」页查看所有仓库的提交记录及审查结果：合规、警告、非法。',
      '提交信息建议遵循约定式提交格式（如 feat: / fix: 前缀），并以仓库的提交审查规则为准。',
      '提交审查结果会汇总到工作台的「Commit 合规率」指标中。',
    ],
  },
  {
    id: 'credential-security',
    title: '凭证与安全',
    icon: KeyRound,
    iconClass: 'icon-emerald',
    intro: '所有外部系统访问统一通过凭证管理，避免在配置中明文暴露账号密码。',
    bullets: [
      '在「凭证」页按类型（GitLab Token、SVN 账号、Nexus 账号等）录入凭证，敏感字段加密存储。',
      '凭证在列表与接口返回中均脱敏展示，仅录入者可查看完整信息。',
      '仓库读取、推 Tag、删除 Tag 等 Git 操作必须使用有效的凭证借用授权；打包推送 SVN 按对应配置解析凭证。',
      '凭证到期或失效时请及时更新，避免发布推 Tag、打包推送等流程失败。',
    ],
  },
  {
    id: 'workflow',
    title: '审批中心',
    icon: GitPullRequestArrow,
    iconClass: 'icon-cyan',
    intro: '审批中心集中展示与你相关的审批任务，支持多种审批模式。',
    bullets: [
      '「待我审批」展示当前节点需要处理的任务，「我发起的」可跟踪自己提交的发布审批进度。',
      '审批动作支持通过、驳回、转交、回退；节点可配置为串行审批、或签（任一人通过即可）或会签（所有人通过）。',
      '审批通过后发布自动执行推 Tag，无需人工再次操作。',
      '申请人在审批未完成前可撤销申请，流程终止后发布回到草稿状态。',
    ],
  },
  {
    id: 'notification',
    title: '通知与待办',
    icon: Bell,
    iconClass: 'icon-indigo',
    intro: '站内通知覆盖审批、构建、发布和系统消息，重要事项不会遗漏。',
    bullets: [
      '顶栏铃铛图标实时提示未读数量，点击可快速跳转「通知中心」。',
      '通知按类型筛选（审批 / 构建 / 发布 / 系统），支持单条已读与全部已读。',
      '工作台「待办」面板汇总待审批、打包中、被驳回等事项，可直接跳转处理。',
    ],
  },
  {
    id: 'system-admin',
    title: '系统管理（管理员）',
    icon: Settings,
    iconClass: 'icon-indigo',
    intro: '以下功能仅系统管理员可见，用于平台级维护。',
    bullets: [
      '用户管理：创建本地用户或接入 LDAP 用户，分配角色、启停账号。',
      '角色管理：自定义角色并勾选权限模块，控制各功能页面的可见性。',
      '系统配置：维护平台参数，包括 Nexus 连接信息（地址、账号、仓库）等。',
      '打包镜像：聚合查看本地与 Nexus 镜像，支持上传 tar 包导入本地。',
      '操作日志：审计用户关键操作，便于问题追溯与安全审计。',
    ],
  },
  {
    id: 'faq',
    title: '常见问题',
    icon: CircleHelp,
    iconClass: 'icon-amber',
    bullets: [
      '看不到某个菜单？菜单按角色权限过滤，请联系系统管理员确认角色已分配对应权限模块。',
      '版本号不符合预期？检查所选仓库的版本号规则和已有 Tag；也可以创建发布时手动填写版本号覆盖自动计算结果。',
      '提交审批按钮不可点？确认发布处于「草稿」状态且发布说明非空。',
      '发布后没有自动打包？检查本次产品与仓库对应的打包配置是否开启「发布后自动打包」，并确认镜像与凭证配置正确。',
      '推 Tag 失败导致发布被驳回？通常是凭证失效或分支保护限制，更新凭证后在发布详情查看驳回原因并重新发起。',
      '打包产物没有推送到 SVN？检查打包配置中的 SVN 推送开关、目标路径与 SVN 凭证是否有效。',
    ],
  },
];

const moduleEntries = [
  { icon: FolderKanban, name: '产品', path: '/projects', desc: '组织成员、关联仓库与发布' },
  { icon: GitFork, name: '仓库', path: '/repositories', desc: '接入 GitLab 代码仓库' },
  { icon: KeyRound, name: '凭证', path: '/credentials', desc: '加密管理访问凭证' },
  { icon: Tag, name: '新建发布', path: '/releases/create', desc: '发起版本发布申请' },
  { icon: Rocket, name: '发布看板', path: '/releases', desc: '跟踪发布全生命周期' },
  { icon: GitPullRequestArrow, name: '审批中心', path: '/workflows', desc: '处理发布审批任务' },
  { icon: Hammer, name: '打包看板', path: '/packages', desc: '执行与跟踪打包任务' },
  { icon: ScanSearch, name: '提交审查', path: '/commits', desc: '提交规范合规检查' },
  { icon: Bell, name: '通知', path: '/notifications', desc: '站内消息与待办提醒' },
  { icon: FileText, name: '发布说明', path: '/releases', desc: 'Markdown 发布文档' },
  { icon: Boxes, name: '打包镜像', path: '/system/package-images', desc: '本地与 Nexus 镜像' },
  { icon: ShieldCheck, name: '角色权限', path: '/system/roles', desc: '模块级权限控制' },
];

export default function Guide() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState(sections[0].id);

  const scrollTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-5 page-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">使用说明</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            从创建产品、关联仓库到完成发布的完整操作指引，按角色快速找到适合自己的使用路径
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[12px] text-slate-500">
          <BookOpen className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
          <span>共 {sections.length} 个章节</span>
        </div>
      </div>

      <div className="tech-card rounded-xl p-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">功能地图</h2>
        <p className="mt-1 text-[12px] text-slate-400">点击卡片可跳转到对应功能页面</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {moduleEntries.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => navigate(entry.path)}
              className="group flex items-start gap-2.5 rounded-lg border border-indigo-50 bg-white px-3 py-2.5 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
            >
              <entry.icon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" strokeWidth={1.5} />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-slate-800 group-hover:text-indigo-600">{entry.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-slate-400">{entry.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[200px_1fr]">
        <div className="hidden lg:block">
          <div className="tech-card sticky top-[76px] rounded-xl p-3">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">目录</div>
            <div className="space-y-0.5">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollTo(section.id)}
                  className={[
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors',
                    activeSection === section.id
                      ? 'bg-indigo-50 text-indigo-600'
                      : 'text-slate-500 hover:bg-indigo-50/60 hover:text-indigo-600',
                  ].join(' ')}
                >
                  <section.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  <span className="truncate">{section.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {sections.map((section, sectionIndex) => (
            <section key={section.id} id={`guide-${section.id}`} className="tech-card scroll-mt-[76px] rounded-xl p-5">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${section.iconClass}`}>
                  <section.icon className="h-4 w-4" strokeWidth={1.5} />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
                    {sectionIndex + 1}. {section.title}
                  </h2>
                </div>
              </div>
              {section.intro ? <p className="mt-3 text-[13px] leading-6 text-slate-600">{section.intro}</p> : null}

              {section.steps ? (
                <ol className="mt-4 space-y-3">
                  {section.steps.map((step, stepIndex) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-600">
                        {stepIndex + 1}
                      </span>
                      <div>
                        <div className="text-[13px] font-medium text-slate-800">{step.title}</div>
                        <div className="mt-0.5 text-[12px] leading-5 text-slate-500">{step.desc}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : null}

              {section.bullets ? (
                <ul className="mt-4 space-y-2.5">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2.5">
                      <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={1.5} />
                      <span className="text-[12.5px] leading-5 text-slate-600">{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {section.tips ? (
                <div className="mt-4 space-y-1.5 rounded-lg border border-amber-100 bg-amber-50/50 px-3.5 py-2.5">
                  {section.tips.map((tip) => (
                    <p key={tip} className="text-[12px] leading-5 text-amber-700">
                      提示：{tip}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          ))}

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-5 py-4 text-center text-[12px] text-slate-500">
            仍有疑问？请联系系统管理员，或在「通知中心」查看系统公告获取帮助。
          </div>
        </div>
      </div>
    </div>
  );
}
