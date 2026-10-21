import { useLayoutEffect, useRef, useState } from 'react';
import { Drawer } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, X } from 'lucide-react';
import dayjs from 'dayjs';
import { releaseApi } from '@/api/release';
import { useCompactReleaseHeader } from '@/hooks/useCompactReleaseHeader';
import { usePageScroll } from '@/hooks/usePageScroll';
import { parseCompleteMdTable } from '@/utils/markdownTable';
import type { Release } from '@/types';
import { releaseStatusText, releaseTypeText } from '../constants';
import { CHECKBOX_FIELDS, isCheckboxField } from './releaseDocUtils';
import { ReleaseMarkdown } from './ReleaseMarkdown';
import { ReleaseCommits } from './ReleaseCommits';
import { ReleasePackages } from './ReleasePackages';
import { ReleaseTimeline } from './ReleaseTimeline';
import { FormalChangesPreview } from './FormalChangesPreview';

const tabs = [
  { key: 'notes', label: '发布说明' },
  { key: 'commits', label: '提交记录' },
  { key: 'packages', label: '打包任务' },
] as const;

/** 仅识别完整的标准选项值；含备注或自定义内容的字段继续完整渲染 Markdown。 */
function ReadonlyField({ field, value }: { field: string; value: string }) {
  const config = isCheckboxField(field) ? CHECKBOX_FIELDS[field] : undefined;
  const selected = value.trim().split('、');
  if (!config || !selected.every((option) => config.options.includes(option))
    || (config.exclusive && selected.length !== 1)) {
    return <ReleaseMarkdown content={value} field />;
  }
  return <div className="space-y-3 text-[12px] leading-[18px]">
    {config.options.map((option) => {
      const checked = selected.includes(option);
      return <div key={option} className={`flex items-center gap-[9px] ${checked ? 'text-[#24324b]' : 'text-[#76869f]'}`}>
        <span aria-hidden className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded border ${checked ? 'border-[#4f46e5] bg-[#4f46e5] text-white' : 'border-[#c9d3e2] bg-white'}`}>
          {checked && <Check className="h-[9px] w-[9px]" strokeWidth={2} />}
        </span>
        <span><span className="sr-only">{checked ? '已选：' : '未选：'}</span>{option}</span>
      </div>;
    })}
  </div>;
}

function MaintainerReleaseNotes({ release }: { release: Release }) {
  const content = release.release_doc || '';
  const rows = parseCompleteMdTable(content);
  if (!content.trim()) return <p className="py-10 text-center text-[13px] text-[#76869f]">尚未生成发布说明</p>;

  return <>
    <div className="overflow-hidden rounded-2xl border border-[#e9edf5] bg-white">
      {rows.length ? <table className="w-full table-fixed border-collapse text-left">
        <colgroup><col className="w-[100px]" /><col /></colgroup>
        <thead className="h-9 bg-[#eff2f9] text-[12px] font-medium text-[#76869f]">
          <tr>
            <th scope="col" className="border-r border-[#e9edf5] px-[15px] font-medium">项目</th>
            <th scope="col" className="px-[15px] font-medium">内容</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => <tr key={index} className="border-t border-[#e9edf5]">
            <th scope="row" className={`break-words border-r border-[#e9edf5] bg-[#f8fafd] px-[15px] align-top text-[12px] font-medium leading-[1.6] text-[#76869f] ${row.key === '当前发布版本号' ? 'py-[7px]' : 'py-[15px]'}`}>
              {row.key === '当前发布版本号' ? <>当前发布<br />版本号</> : row.key}
            </th>
            <td className={`release-note-value break-words px-[15px] py-[15px] align-top [overflow-wrap:anywhere] ${['当前发布版本号', 'Git提交hash'].includes(row.key) ? 'font-mono [&_.release-markdown]:text-[11px]!' : ''} [&_.release-markdown]:leading-[1.65]! [&_.release-markdown]:text-[#24324b]!`}>
              <ReadonlyField field={row.key} value={row.value} />
            </td>
          </tr>)}
        </tbody>
      </table> : <div className="min-w-0 p-4"><ReleaseMarkdown content={content} /></div>}
    </div>
    <p className="py-4 text-center text-[11px] text-[#9aa8bd]">— 发布说明结束 —</p>
  </>;
}

function VersionInformation({ release, open, onClose }: { release: Release; open: boolean; onClose: () => void }) {
  const reference = useQuery({
    queryKey: ['release-reference', release.id, release.tag_cleanup_status, release.source_rc],
    queryFn: () => releaseApi.getSourceReference(release.id),
    enabled: open && (release.status === 'released' || !!release.source_rc),
    retry: false,
  });
  const fields: { label: string; value: string; mono?: boolean; href?: string }[] = [
    { label: '发布人', value: release.publisher_name || release.publisher || '-' },
    { label: '创建时间', value: dayjs(release.created_at).format('YYYY-MM-DD HH:mm') },
    { label: '分支', value: release.branch || '-', mono: true },
    { label: 'Tag', value: release.tag_name || '-', mono: true },
    { label: 'Git Hash', value: release.git_hash || '-', mono: true },
  ];
  if (release.source_rc) {
    fields.push({ label: '来源 RC', value: [release.source_rc_version, release.source_rc_tag].filter(Boolean).join(' · ') || '-', href: `/releases/${release.source_rc}` });
    if (release.source_rc_git_hash) fields.push({ label: '来源提交', value: release.source_rc_git_hash, mono: true });
  }
  if (reference.data) fields.push({ label: '源码引用', value: reference.data.available ? reference.data.reference || '-' : reference.data.reason || '不可用', mono: true });
  if (release.release_type === 'rc') fields.push({ label: '清理状态', value: release.tag_cleanup_status === 'cleaned' ? '平台已清理' : release.tag_cleanup_status === 'external_missing' ? '已确认缺失' : '未记录清理' });
  if (release.tag_cleaned_at) fields.push({ label: '最近核验', value: dayjs(release.tag_cleaned_at).format('YYYY-MM-DD HH:mm') });
  if (release.tag_cleanup_reference) fields.push({ label: '保护引用', value: release.tag_cleanup_reference, mono: true });
  for (const item of release.cleanup_history || []) fields.push({ label: '清理记录', value: `${item.created_at} · ${item.message} · 操作者 ${item.actor_name || item.actor_id || '已删除账号'}` });

  return <Drawer open={open} onClose={onClose} placement="bottom" size="min(688px, 90dvh)" closable={false}
    styles={{ body: { padding: '10px 24px 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }, section: { borderRadius: '24px 24px 0 0' }, mask: { background: 'rgba(21,37,65,0.25)' } }}>
    <div className="shrink-0">
    <div className="mx-auto mb-[15px] h-1 w-10 rounded-full bg-[#d8deea]" />
    <div className="flex h-8 items-center justify-between">
      <h2 className="text-[18px] font-semibold leading-8 text-[#24324b]">版本信息</h2>
      <button type="button" aria-label="关闭版本信息" onClick={onClose} className="-mr-[11px] flex h-11 w-11 items-center justify-center text-[#76869f]">
        <X className="h-[18px] w-[18px]" strokeWidth={1.65} />
      </button>
    </div>
    <p className="mb-[18px] mt-2 break-words text-[12px] leading-[26px] text-[#76869f]">{release.project_name} / {release.component_name || release.repository_name} · {release.version}</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-[max(32px,env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <dl className="rounded-xl bg-[#f7f8fc] px-[14px] py-[6px] text-[12px] text-[#24324b]">
      {fields.map((field, index) => <div key={`${field.label}-${index}`} className="grid min-h-[43px] grid-cols-[102px_minmax(0,1fr)] items-start border-b border-[#e8ecf4] py-[13px] last:border-0">
        <dt className="text-[#76869f]">{field.label}</dt>
        <dd className={`break-words [overflow-wrap:anywhere] ${field.mono ? 'font-mono' : ''}`}>{field.href ? <Link to={field.href} onClick={onClose} className="text-[#4f46e5]">{field.value}</Link> : field.value}</dd>
      </div>)}
      {release.redmine_url && <div className="border-t border-[#e8ecf4]">
        <a href={release.redmine_url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-between text-[#4f46e5]">
          Redmine 任务<ChevronRight className="h-3.5 w-3.5" strokeWidth={1.65} />
        </a>
      </div>}
    </dl>
    {reference.error && <p role="alert" className="mt-3 break-words text-[12px] text-rose-600">源码引用核验失败：{reference.error.message}</p>}
    <div className="mt-[26px]"><ReleaseTimeline release={release} compact /></div>
    {open && release.source_rc && <div className="mt-5"><FormalChangesPreview release={release} /></div>}
    </div>
  </Drawer>;
}

/** 对照 Penpot「维保 · 09 / 11 / 12 / 13 / 14」，仅在纯维保手机布局挂载。 */
export function MaintainerReleaseDetail({ release }: { release: Release }) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['key']>('notes');
  const [infoOpen, setInfoOpen] = useState(false);
  const compact = useCompactReleaseHeader();
  const { getScrollTop, getCompactScrollTop, scrollTo } = usePageScroll();
  const tabPositions = useRef<Partial<Record<(typeof tabs)[number]['key'], number>>>({});
  const pendingPosition = useRef<number | null>(null);
  const panelId = `maintainer-release-${release.id}`;
  useLayoutEffect(() => {
    if (pendingPosition.current === null) return;
    scrollTo(pendingPosition.current);
    pendingPosition.current = null;
  }, [activeTab, scrollTo]);
  const changeTab = (next: (typeof tabs)[number]['key']) => {
    if (next === activeTab) return;
    tabPositions.current[activeTab] = getScrollTop();
    pendingPosition.current = tabPositions.current[next] ?? (compact ? getCompactScrollTop() ?? 0 : 0);
    setActiveTab(next);
  };

  return <div className="min-w-0 text-[#24324b]">
    <section data-release-overview aria-label="版本概要" className="bg-white px-6 pb-px pt-[9px]">
      <div className="flex min-h-[22px] items-center gap-3 text-[12px]">
        <Link to={`/projects/${release.project}`} className="min-w-0 truncate text-[#76869f]">{release.project_name || '-'}</Link>
        <ChevronRight className="h-[9px] w-[9px] shrink-0 text-[#afb9cc]" strokeWidth={1.65} />
        <Link to={`/repositories/${release.repository}`} className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#24324b]">{release.component_name || release.repository_name || '-'}</Link>
        <span className="flex shrink-0 items-center gap-[7px] text-[11px] text-[#238264]">
          <span className="h-[5px] w-[5px] rounded-full bg-[#29a67c]" />{releaseStatusText[release.status]}
        </span>
      </div>
      <div className="mt-[9px] flex min-h-10 items-center justify-between gap-3">
        <h1 className="min-w-0 break-words font-mono text-[29px] font-semibold leading-10 tracking-tight [overflow-wrap:anywhere]">{release.version}</h1>
        <span className="shrink-0 rounded-md bg-[#eeedff] px-[11px] py-1 text-[11px] font-medium leading-[14px] text-[#4f46e5]">{releaseTypeText[release.release_type]}</span>
      </div>
      <div className="flex h-[41px] items-center justify-between gap-2">
        <p className="min-w-0 break-words text-[12px] leading-[23px] text-[#76869f]">{release.publisher_name || release.publisher || '-'}发布 · {dayjs(release.created_at).format('MM-DD HH:mm')}</p>
        <button type="button" onClick={() => setInfoOpen(true)} className="-mr-2 flex min-h-11 shrink-0 items-center gap-[9px] px-2 text-[12px] font-medium text-[#4f46e5]">
          版本信息<ChevronRight className="h-[13px] w-[13px]" strokeWidth={1.65} />
        </button>
      </div>
      <p className="flex min-h-[26px] items-center gap-3 rounded-md bg-[#f6f7fb] px-3 py-1 font-mono text-[11px] leading-[18px] text-[#76869f]">
        <span className="min-w-0 break-all">{release.branch || '-'}</span><span>/</span><span className="min-w-0 break-all">Tag {release.tag_name || '-'}</span>
      </p>
    </section>
    <div className="sticky top-0 z-20 -mt-10">
      <div data-release-compact-summary aria-hidden={!compact} className={`flex h-10 items-start justify-between gap-3 bg-white px-6 pt-[5px] leading-[25px] ${compact ? '' : 'invisible pointer-events-none'}`}>
        <span className="min-w-0 truncate text-[12px] text-[#76869f]">{release.project_name} / {release.component_name || release.repository_name}</span>
        <span className="shrink-0 text-[11px] text-[#238264]">{releaseStatusText[release.status]}</span>
      </div>
      <div role="tablist" aria-label="发布详情内容" className="flex border-b border-[#e9edf5] bg-white px-4">
      {tabs.map((tab) => <button key={tab.key} type="button" role="tab" id={`${panelId}-${tab.key}-tab`} aria-selected={activeTab === tab.key}
        aria-controls={`${panelId}-${tab.key}`} tabIndex={activeTab === tab.key ? 0 : -1} onClick={() => changeTab(tab.key)}
        onKeyDown={(event) => {
          const index = tabs.findIndex((item) => item.key === tab.key);
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
          if (next === undefined) return;
          event.preventDefault();
          changeTab(tabs[next].key);
          document.getElementById(`${panelId}-${tabs[next].key}-tab`)?.focus({ preventScroll: true });
        }}
        className={`relative flex h-12 min-w-0 flex-1 items-center justify-center text-[13px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500 ${activeTab === tab.key ? 'font-semibold text-[#4f46e5] after:absolute after:bottom-0 after:h-[3px] after:w-7 after:rounded-full after:bg-[#4f46e5]' : 'text-[#76869f]'}`}>
        {tab.label}
      </button>)}
      </div>
    </div>
    <div className="min-h-[calc(var(--maintainer-content-height)_-_48px)] p-4">
      <div role="tabpanel" id={`${panelId}-notes`} aria-labelledby={`${panelId}-notes-tab`} hidden={activeTab !== 'notes'}>
        <MaintainerReleaseNotes release={release} />
      </div>
      {activeTab !== 'notes' && <div role="tabpanel" id={`${panelId}-${activeTab}`} aria-labelledby={`${panelId}-${activeTab}-tab`}>
        {activeTab === 'commits' ? <ReleaseCommits release={release} maintainerMobile /> : <ReleasePackages release={release} maintainerMobile />}
      </div>}
    </div>
    <VersionInformation release={release} open={infoOpen} onClose={() => setInfoOpen(false)} />
  </div>;
}
