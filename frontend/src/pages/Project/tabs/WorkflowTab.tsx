import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Workflow,
  Settings2,
  Play,
  Flag,
  Plus,
  X,
  Check,
  Info,
  Trash2,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  Rocket,
  GitPullRequest,
  FlaskConical,
  Crown,
  ShieldCheck,
  User,
  UserCog,
  UserCheck,
  Users,
} from 'lucide-react';
import { TsModal } from '@/components/TsModal';
import { Dropdown } from '@/components/Dropdown';
import { ApprovalFlowPreview } from '@/components/ApprovalFlowPreview';
import { PermissionAlert } from '@/components/PermissionAlert';
import { workflowApi } from '@/api/workflow';
import { accountApi } from '@/api/account';
import { useAppMessage } from '@/hooks/useAppMessage';
import { useProjectRole } from '@/hooks/useProjectRole';
import type {
  Project,
  WorkflowDefinition,
  WorkflowNodeConfig,
  WorkflowApproverConfig,
} from '@/types';

interface WorkflowTabProps {
  project: Project;
}

type FlowType = 'formal' | 'rc' | 'beta';

/** 发布类型元信息 */
const FLOW_META: Record<FlowType, {
  name: string;
  icon: typeof Rocket;
  iconCls: string;
  desc: string;
  title: string;
}> = {
  formal: { name: '正式发布审批', icon: Rocket, iconCls: 'icon-emerald', desc: '无前缀 Tag', title: '审批链 · 正式发布' },
  rc: { name: 'RC 发布审批', icon: GitPullRequest, iconCls: 'icon-cyan', desc: 'Tag 自动加 rc- 前缀', title: '审批链 · RC 发布' },
  beta: { name: 'Beta 发布审批', icon: FlaskConical, iconCls: 'icon-amber', desc: 'Tag 自动加 beta- 前缀', title: '审批链 · Beta 发布' },
};

const FLOW_ORDER: FlowType[] = ['formal', 'rc', 'beta'];

/** 审批人类型元信息 */
const APPROVER_META: Record<string, { label: string; icon: typeof Crown; cls: string }> = {
  leader: { label: '项目负责人', icon: Crown, cls: 'icon-violet' },
  role: { label: '指定角色', icon: ShieldCheck, cls: 'icon-indigo' },
  user: { label: '指定用户', icon: User, cls: 'icon-cyan' },
  self: { label: '发起人自己', icon: UserCog, cls: 'icon-emerald' },
};

/** 审批模式元信息 */
const MODE_META: Record<'any' | 'all', { label: string; icon: typeof UserCheck; chipCls: string; cardIconCls: string }> = {
  any: { label: '或签', icon: UserCheck, chipCls: 'border-blue-200 bg-blue-50 text-blue-600', cardIconCls: 'icon-indigo' },
  all: { label: '会签', icon: Users, chipCls: 'border-amber-200 bg-amber-50 text-amber-600', cardIconCls: 'icon-amber' },
};

const APPROVER_TYPE_OPTIONS = [
  { label: '项目负责人 (leader)', value: 'leader' },
  { label: '指定角色', value: 'role' },
  { label: '指定用户', value: 'user' },
  { label: '发起人自己 (self)', value: 'self' },
];

const ROLE_OPTIONS = [
  { label: '开发人员', value: 'developer' },
  { label: '测试人员', value: 'tester' },
  { label: '项目管理员', value: 'manager' },
  { label: '审核人', value: 'auditor' },
  { label: '只读人员', value: 'viewer' },
];

const ROLE_LABELS: Record<string, string> = {
  developer: '开发人员',
  tester: '测试人员',
  manager: '项目管理员',
  auditor: '审核人',
  viewer: '只读人员',
};

/** 生成节点 ID */
function genNodeId() {
  return `approval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 默认节点 */
function defaultNode(): WorkflowNodeConfig {
  return { node_id: genNodeId(), node_name: '新建审批节点', mode: 'any', approvers: [{ type: 'leader' }] };
}

/** 审批人展示文案 */
function approverDisplay(apr: WorkflowApproverConfig, usersData?: { results: { id: string; nickname?: string; username: string }[] }) {
  const meta = APPROVER_META[apr.type] || APPROVER_META.leader;
  let label = meta.label;
  let sub = '';
  if (apr.type === 'leader') {
    sub = '系统自动解析为项目 leader';
  } else if (apr.type === 'self') {
    sub = '发起人自己 · self';
  } else if (apr.type === 'role') {
    label = ROLE_LABELS[apr.role || ''] || apr.role || '未选择角色';
    sub = `指定角色 · ${apr.role || ''}`;
  } else if (apr.type === 'user') {
    const u = usersData?.results.find((x) => x.id === apr.user_id);
    label = u ? (u.nickname || u.username) : '未选择用户';
    sub = `指定用户 · ${u?.username || apr.user_id || ''}`;
  }
  return { label, sub, icon: meta.icon, cls: meta.cls };
}

export function WorkflowTab({ project }: WorkflowTabProps) {
  const queryClient = useQueryClient();
  const { message } = useAppMessage();

  // 审批节点编辑：manager 成员角色（与后端 IsProjectManager 对齐）
  const { canManage } = useProjectRole(project);

  const [editOpen, setEditOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<WorkflowDefinition | null>(null);
  const [preview, setPreview] = useState<WorkflowDefinition | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const [pendingAprType, setPendingAprType] = useState<string>('leader');
  const [pendingAprRole, setPendingAprRole] = useState<string>('');
  const [pendingAprUserId, setPendingAprUserId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  /** 本地编辑副本：当前流程的 node_config[] */
  const [nodes, setNodes] = useState<WorkflowNodeConfig[]>([]);
  /** 原始快照用于 diff */
  const [origNodes, setOrigNodes] = useState<WorkflowNodeConfig[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-definitions-tab', project.id],
    queryFn: () => workflowApi.getDefinitions({ project: project.id, page_size: 1000 }),
    enabled: !!project.id,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-for-workflow'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: editOpen,
  });

 /** 切换节点时清空待添加审批人状态，避免右侧表单项停留在上一节点 */
  const selectNode = (idx: number) => {
    setSelIdx(idx);
    setPendingAprRole('');
    setPendingAprUserId('');
    setPendingAprType('leader');
  };

  const sortedData = useMemo(
    () => [...(data?.results || [])].sort(
      (a, b) => FLOW_ORDER.indexOf(a.release_type as FlowType) - FLOW_ORDER.indexOf(b.release_type as FlowType)
    ),
    [data]
  );

  /** 当前编辑流程对应的发布类型元信息 */
  const curMeta = editingDef ? (FLOW_META[editingDef.release_type as FlowType] || FLOW_META.formal) : FLOW_META.formal;

  /** 打开编辑弹窗：拷贝该流程的 node_config 到本地 */
 const openEdit = (def: WorkflowDefinition) => {
    const snap = Array.isArray(def.node_config)
      ? def.node_config.map((n) => ({ ...n, approvers: (n.approvers || []).map((a) => ({ ...a })) }))
      : [defaultNode()];
    setNodes(snap);
    setOrigNodes(JSON.parse(JSON.stringify(snap)));
    setEditingDef(def);
    selectNode(0);
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditingDef(null);
  };

  /** 更新当前选中节点 */
  const updateNode = (patch: Partial<WorkflowNodeConfig>) => {
    setNodes((prev) => {
      const next = [...prev];
      next[selIdx] = { ...next[selIdx], ...patch };
      return next;
    });
  };

  /** 交换节点 */
  const moveNode = (idx: number, dir: -1 | 1) => {
    const next = [...nodes];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setNodes(next);
    selectNode(target);
  };

  /** 添加节点 */
  const addNode = () => {
    const next = [...nodes, defaultNode()];
    setNodes(next);
    selectNode(next.length - 1);
  };

  /** 删除节点 */
  const delNode = () => {
    const next = [...nodes];
    next.splice(selIdx, 1);
    setNodes(next);
    selectNode(Math.max(0, selIdx - 1));
  };

  /** 添加审批人 */
  const addApprover = () => {
    const apr: WorkflowApproverConfig = { type: pendingAprType as WorkflowApproverConfig['type'] };
    if (pendingAprType === 'role') {
      if (!pendingAprRole) { message.error('请选择角色'); return; }
      apr.role = pendingAprRole;
    } else if (pendingAprType === 'user') {
      if (!pendingAprUserId) { message.error('请选择用户'); return; }
      apr.user_id = pendingAprUserId;
    }
    const node = nodes[selIdx];
    const approvers = [...(node.approvers || []), apr];
    updateNode({ approvers });
    setPendingAprRole('');
    setPendingAprUserId('');
  };

  /** 移除审批人 */
  const removeApprover = (i: number) => {
    const node = nodes[selIdx];
    if ((node.approvers || []).length <= 1) return;
    const approvers = (node.approvers || []).filter((_, idx) => idx !== i);
    updateNode({ approvers });
  };

  /** 保存：有变更才提交 */
  const handleSave = async () => {
    if (!editingDef) return;
    if (JSON.stringify(nodes) === JSON.stringify(origNodes)) {
      message.info('无变更');
      closeEdit();
      return;
    }
    setSaving(true);
    try {
      await workflowApi.updateDefinition(editingDef.id, { node_config: nodes });
      message.success('保存成功');
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions-tab'] });
      closeEdit();
    } catch {
      // 保存失败由全局拦截器统一提示
    } finally {
      setSaving(false);
    }
  };

  const curNode = nodes[selIdx];

  return (
    <div className="space-y-4">
      <PermissionAlert error={error} className="rounded-xl" />

      {/* 流程列表 */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="py-8 text-center text-[13px] text-slate-400">加载中…</div>
        ) : sortedData.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-slate-400">暂无流程定义</div>
        ) : (
          sortedData.map((def) => {
            const rt = def.release_type as FlowType;
            const meta = FLOW_META[rt] || FLOW_META.formal;
            const Icon = meta.icon;
            const nodeCount = def.node_config?.length || 0;
            return (
              <div
                key={def.id}
                className="tech-card flex items-center gap-3 rounded-xl p-4"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${meta.iconCls}`}>
                  <Icon className="h-4 w-4" style={{ strokeWidth: 1.5 }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-slate-900">{def.name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{meta.desc} · {nodeCount} 个审批节点</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreview(def)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
                  >
                    预览
                  </button>
                  {canManage && (
                    <button
                      onClick={() => openEdit(def)}
                      className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
                    >
                      编辑节点
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 大号编辑弹窗 */}
      <TsModal
        title={`编辑审批节点 · ${editingDef?.name || ''}`}
        subtitle="流程为项目内置，仅可调整审批节点与审批人"
        titleIcon={<Workflow className="h-[18px] w-[18px]" style={{ strokeWidth: 1.5 }} />}
        open={editOpen}
        onCancel={closeEdit}
        width={1120}
        confirmLoading={saving}
        onOk={handleSave}
        bodyStyle={{ maxHeight: '72vh' }}
        bodyClassName="space-y-5"
        footer={(
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Info className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
              节点变更将重新生成流程图，已有进行中实例不受影响
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={closeEdit}
                className="rounded-lg px-4 py-2 text-[13px] font-medium text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-600"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" style={{ strokeWidth: 2 }} />
                保存
              </button>
            </div>
          </div>
        )}
      >
        {/* 主体：左流程图 + 右节点编辑器 */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          {/* 左：审批链可视化 */}
          <section className="lg:col-span-3">
            <div className="tech-card overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-slate-400" style={{ strokeWidth: 1.5 }} />
                  <h2 className="text-[14px] font-semibold text-slate-900">{curMeta.title}</h2>
                </div>
                {canManage && (
                  <button
                    onClick={addNode}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/40 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-indigo-300 hover:bg-white hover:text-indigo-600"
                  >
                    <Plus className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                    添加节点
                  </button>
                )}
              </div>
              <div className="px-5 py-6">
                {/* 开始 */}
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg icon-emerald">
                    <Play className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                  </span>
                  <div>
                    <div className="text-[13px] font-medium text-slate-900">开始</div>
                    <div className="text-[11px] text-slate-400">提交发布申请</div>
                  </div>
                </div>
                <div className="ml-4 h-6 w-px bg-slate-200" />

                {/* 节点列表 */}
                {nodes.map((node, idx) => {
                  const active = idx === selIdx;
                  const mode = MODE_META[node.mode as 'any' | 'all'] || MODE_META.any;
                  const ModeIcon = mode.icon;
                  return (
                    <div key={node.node_id || idx}>
                      <div
                        onClick={() => selectNode(idx)}
                        className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                          active
                            ? 'border-indigo-300 bg-indigo-50/40 ring-1 ring-indigo-200'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold ${
                              active ? 'btn-glow text-white' : 'icon-indigo'
                            }`}>
                              {idx + 1}
                            </span>
                            <div>
                              <div className="text-[13px] font-semibold text-slate-900">{node.node_name || '未命名节点'}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${mode.chipCls}`}>
                                  <ModeIcon className="h-2.5 w-2.5" style={{ strokeWidth: 1.5 }} />
                                  {mode.label}
                                </span>
                                {(node.approvers || []).map((apr, ai) => {
                                  const d = approverDisplay(apr, usersData);
                                  const AI = d.icon;
                                  return (
                                    <span key={ai} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                                      <AI className="h-2.5 w-2.5" style={{ strokeWidth: 1.5 }} />
                                      {d.label}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                          {active && canManage && (
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); moveNode(idx, -1); }}
                                disabled={idx === 0}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 bg-white text-indigo-500 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-indigo-100 disabled:hover:text-indigo-500"
                              >
                                <ChevronUp className="h-4 w-4" style={{ strokeWidth: 2 }} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); moveNode(idx, 1); }}
                                disabled={idx === nodes.length - 1}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-indigo-100 bg-white text-indigo-500 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-indigo-100 disabled:hover:text-indigo-500"
                              >
                                <ChevronDown className="h-4 w-4" style={{ strokeWidth: 2 }} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="ml-4 h-4 w-px bg-slate-200" />
                    </div>
                  );
                })}

                {/* 完成 */}
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400">
                    <Flag className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                  </span>
                  <div>
                    <div className="text-[13px] font-medium text-slate-900">完成</div>
                    <div className="text-[11px] text-slate-400">推送 Tag，发布生效</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 右：节点编辑面板 */}
          <aside className="lg:col-span-2">
            <div className="tech-card overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-slate-400" style={{ strokeWidth: 1.5 }} />
                  <h2 className="text-[14px] font-semibold text-slate-900">节点配置</h2>
                </div>
                <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">节点 {selIdx + 1}</span>
              </div>
              <div className="px-5 py-5">
                {curNode ? (
                  <>
                    {/* 节点名称 */}
                    <div className="mb-5">
                      <label className="mb-1.5 flex items-center gap-1 text-[12.5px] font-medium text-slate-600">
                        节点名称<span className="text-rose-500">*</span>
                      </label>
                      <input
                        value={curNode.node_name || ''}
                        onChange={(e) => updateNode({ node_name: e.target.value })}
                        placeholder="如：技术负责人审批"
                        className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none transition-colors placeholder:text-slate-400 hover:border-indigo-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      />
                    </div>

                    {/* 审批模式 */}
                    <div className="mb-5">
                      <label className="mb-1.5 flex items-center gap-1 text-[12.5px] font-medium text-slate-600">
                        审批模式<span className="text-rose-500">*</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['any', 'all'] as const).map((m) => {
                          const meta = MODE_META[m];
                          const MIcon = meta.icon;
                          const on = curNode.mode === m;
                          return (
                            <button
                              key={m}
                              onClick={() => updateNode({ mode: m })}
                              className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-all ${
                                on ? 'border-indigo-500 bg-indigo-50 shadow-[0_0_0_3px_rgba(99,102,241,.1)]' : 'border-indigo-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/30'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg ${meta.cardIconCls}`}>
                                  <MIcon className="h-4 w-4" style={{ strokeWidth: 1.5 }} />
                                </span>
                                {on
                                  ? <CheckCircle2 className="h-3.5 w-3.5 text-indigo-500" style={{ strokeWidth: 1.5 }} />
                                  : <span className="h-3.5 w-3.5 rounded-full border border-slate-200" />}
                              </div>
                              <div className="mt-1 text-[12px] font-semibold text-slate-900">{meta.label}</div>
                              <div className="text-[10px] text-slate-400">{m === 'any' ? '任一审批人通过' : '全部通过才生效'}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 审批人列表 */}
                    <div className="mb-5">
                      <label className="mb-2 block text-[12.5px] font-medium text-slate-600">审批人</label>
                      <div className="space-y-2">
                        {(curNode.approvers || []).map((apr, i) => {
                          const d = approverDisplay(apr, usersData);
                          const AI = d.icon;
                          return (
                            <div
                              key={i}
                              className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-white px-2.5 py-2 transition-colors hover:border-indigo-200"
                            >
                              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${d.cls}`}>
                                <AI className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12px] font-medium text-slate-900">{d.label}</div>
                                <div className="text-[10px] text-slate-400">{d.sub}</div>
                              </div>
                              <button
                                onClick={() => removeApprover(i)}
                                className="text-slate-300 transition-colors hover:text-rose-500"
                              >
                                <X className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* 添加审批人 */}
                      {canManage && (
                        <div className="mt-2.5 rounded-lg border border-dashed border-slate-200 p-2.5">
                          <div className="flex items-center gap-2">
                            <Dropdown
                              value={pendingAprType}
                              onChange={setPendingAprType}
                              placeholder="选择类型"
                              className="flex-1"
                              options={APPROVER_TYPE_OPTIONS.map((o) => {
                                const M = APPROVER_META[o.value];
                                const Ic = M?.icon;
                                return {
                                  value: o.value,
                                  label: o.label,
                                  icon: Ic ? <Ic className="h-3.5 w-3.5 text-slate-400" style={{ strokeWidth: 1.5 }} /> : null,
                                };
                              })}
                            />
                            {pendingAprType === 'role' && (
                              <Dropdown
                                value={pendingAprRole}
                                onChange={setPendingAprRole}
                                placeholder="选择角色"
                                width={180}
                                options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                              />
                            )}
                            {pendingAprType === 'user' && (
                              <Dropdown
                                value={pendingAprUserId}
                                onChange={setPendingAprUserId}
                                placeholder="选择用户"
                                width={220}
                                options={(usersData?.results || []).map((u) => ({
                                  value: u.id,
                                  label: `${u.nickname || u.username} (${u.username})`,
                                }))}
                              />
                            )}
                            <button
                              onClick={addApprover}
                              className="btn-glow shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
                            >
                              添加
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 删除节点 */}
                    {canManage && (
                      <div className="flex items-center justify-between border-t border-indigo-50 pt-4">
                       <button
                         onClick={delNode}
                         className="inline-flex items-center gap-1.5 text-[12px] font-medium text-rose-500 transition-colors hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3.5 w-3.5" style={{ strokeWidth: 1.5 }} />
                          删除节点
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-8 text-center text-[13px] text-slate-400">请选择左侧节点</div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </TsModal>

      {/* 流程预览弹窗 */}
      <TsModal
        title={`流程预览：${preview?.name || ''}`}
        open={!!preview}
        onCancel={() => setPreview(null)}
        width={560}
        footer={null}
      >
        {preview?.node_config?.length ? (
          <div className="rounded-lg border border-slate-200 bg-white">
            <ApprovalFlowPreview nodeConfig={preview.node_config} />
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-slate-400">暂无审批链，请先配置节点</div>
        )}
      </TsModal>
    </div>
  );
}
