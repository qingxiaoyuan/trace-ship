import { useEffect, useRef, useState } from 'react';
import { Drawer, Grid, Popover } from 'antd';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Folder, LayoutGrid, Search, Workflow, X } from 'lucide-react';
import type { MaintainerProjectScope } from '@/api/dashboard';

export interface MaintainerScope { project?: string; repository?: string }

interface Props {
  projects: MaintainerProjectScope[];
  value: MaintainerScope;
  disabled?: boolean;
  onApply: (value: MaintainerScope) => void;
}

/** 桌面即时筛选，手机先编辑临时范围；关闭抽屉不改变已应用条件。 */
export function MaintainerScopePicker({ projects, value, disabled, onApply }: Props) {
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MaintainerScope>({});
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || mobile) return;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLInputElement>('input[aria-label="搜索项目或软件"]')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, mobile]);
  const orderedProjects = [...projects].sort((first, second) => second.release_count - first.release_count || first.name.localeCompare(second.name, 'zh-CN'));
  const project = projects.find((item) => item.id === value.project);
  const software = project?.software.find((item) => item.id === value.repository);
  const draftProject = projects.find((item) => item.id === draft.project);
  const draftSoftware = draftProject?.software.find((item) => item.id === draft.repository);
  const label = `${project?.name || '全部项目'} · ${software?.name || '全部软件'}`;

  const change = (next: MaintainerScope) => {
    setDraft(next);
    if (!mobile) { onApply(next); setOpen(false); }
  };
  const option = (text: string, next: MaintainerScope, count?: number, icon = false) => {
    const checked = draft.project === next.project && draft.repository === next.repository;
    return <label className={`mnt-scope-option ${checked ? 'is-selected' : ''}`}>
      <input type="radio" name="maintainer-scope" aria-label={text} checked={checked} onChange={() => change(next)} />
      {icon && <LayoutGrid size={15} aria-hidden />}
      <span>{next.project ? projects.find((item) => item.id === next.project)?.software.find((item) => item.id === next.repository)?.name || '全部软件' : text}</span>
      {count !== undefined && <small>{count} 个版本</small>}
      {checked ? <CheckCircle2 size={17} aria-hidden /> : <Circle size={17} aria-hidden />}
    </label>;
  };
  const tree = <>
    <div className="mnt-scope-search"><Search size={15} aria-hidden /><input aria-label="搜索项目或软件" placeholder="搜索项目或软件" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div>
    <div className="mnt-scope-tree" role="radiogroup" aria-label="项目与软件范围">
      {option('全部项目 · 全部软件', {}, undefined, true)}
      {orderedProjects.filter((item) => !keyword || item.name.toLowerCase().includes(keyword.toLowerCase()) || item.software.some((entry) => entry.name.toLowerCase().includes(keyword.toLowerCase()))).map((item) => {
        const isExpanded = expanded.includes(item.id) || !!keyword;
        return <div key={item.id} className="mnt-scope-project">
          <button className="mnt-scope-project-toggle" type="button" aria-expanded={isExpanded}
            onClick={() => setExpanded((current) => isExpanded ? current.filter((id) => id !== item.id) : [...current, item.id])}>
            {isExpanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}<Folder size={16} aria-hidden />
            <span>{item.name}</span><small>{item.software.length} 个软件</small>
          </button>
          {isExpanded && <div className="mnt-scope-children">
            {option(`${item.name} / 全部软件`, { project: item.id }, item.release_count)}
            {item.software.filter((entry) => !keyword || item.name.toLowerCase().includes(keyword.toLowerCase()) || entry.name.toLowerCase().includes(keyword.toLowerCase())).map((entry) =>
              <div key={entry.id}>{option(`${item.name} / ${entry.name}`, { project: item.id, repository: entry.id }, entry.release_count)}</div>)}
          </div>}
        </div>;
      })}
      {!projects.length && <p className="mnt-scope-empty">暂无可选项目</p>}
    </div>
  </>;
  const trigger = <button ref={triggerRef} type="button" className="mnt-scope-trigger" disabled={disabled} aria-label={`选择项目与软件：${label}`} aria-haspopup="dialog" aria-expanded={open}
    onClick={() => { setDraft(value); setKeyword(''); const initialProject = value.project || orderedProjects[0]?.id; setExpanded(initialProject ? [initialProject] : []); setOpen(!open); }}>
    <Workflow size={17} className="mnt-scope-mobile-icon" aria-hidden /><span className="mnt-scope-project-label">项目 · {project?.name || '全部'}</span>
    <ChevronRight className="mnt-scope-desktop-separator" size={12} aria-hidden /><span className="mnt-scope-software-label">软件 · {software?.name || '全部'}</span>
    <span className="mnt-scope-mobile-label">{label}</span><ChevronDown size={15} aria-hidden />
  </button>;

  return <>
    <Popover open={open && !mobile} placement="bottomLeft" arrow={false} content={<div ref={panelRef} role="dialog" aria-label="选择项目与软件" className="mnt-scope-popover"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } }}>{tree}</div>}
      afterOpenChange={(next) => {
        if (next) panelRef.current?.querySelector<HTMLInputElement>('input[aria-label="搜索项目或软件"]')?.focus();
        else if (document.activeElement === document.body || panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      }}
      onOpenChange={(next) => { if (!next) setOpen(false); }} trigger="click">
      {trigger}
    </Popover>
    <Drawer open={open && mobile} aria-label="选择项目与软件" onClose={() => setOpen(false)} placement="bottom" size="min(654px, 82dvh)" closable={false}
      className="mnt-scope-drawer" styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' }, section: { borderRadius: '20px 20px 0 0' }, mask: { background: 'rgba(34, 47, 77, 0.25)' } }}>
      <div className="mnt-scope-handle" />
      <div className="mnt-scope-heading"><h2>选择项目与软件</h2><button type="button" aria-label="关闭范围筛选" onClick={() => setOpen(false)}><X size={18} /></button></div>
      <p className="mnt-scope-description">按项目选择，软件会显示在对应项目下</p>
      <div className="mnt-scope-body">{tree}</div>
      <div className="mnt-scope-footer">
        <p>当前选择：{draftProject?.name || '全部项目'} / {draftSoftware?.name || '全部软件'}</p>
        <div><button type="button" className="mnt-scope-clear" onClick={() => setDraft({})}>清空</button>
          <button type="button" className="mnt-scope-apply" onClick={() => { onApply(draft); setOpen(false); }}>应用筛选</button></div>
      </div>
    </Drawer>
  </>;
}
