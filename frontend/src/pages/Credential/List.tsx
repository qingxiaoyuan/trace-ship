import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { message, Popconfirm, Dropdown } from 'antd';
import { Plus, Search, Filter, Layers, ChevronDown, Eye, Trash2, KeyRound, ShieldCheck, ClockAlert, ShieldX } from 'lucide-react';
import { credentialApi } from '@/api/credential';
import { getAvatarColor } from '@/utils/avatar';
import type { Credential, CredentialType } from '@/types';
import { CredentialIcon } from './components/CredentialIcon';
import { TypeTag } from './components/TypeTag';
import { ScopeTag } from './components/ScopeTag';
import { StatusBadge } from './components/StatusBadge';
import { CredentialModal } from './components/CredentialModal';
import { credentialTypeMap, credentialShareMap, credentialTypeOptions, credentialShareOptions, getCredentialShare } from './constants';
import type { CredentialShare } from './constants';
import { getCredentialStatus, statusConfig } from './utils';

export default function CredentialList() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [credType, setCredType] = useState<CredentialType | ''>('');
  const [share, setShare] = useState<CredentialShare | ''>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['credentials-all'],
    queryFn: () => credentialApi.getCredentials({ page_size: 1000 }),
  });

  const allResults = useMemo(() => data?.results || [], [data]);

  const filtered = useMemo(() => {
    return allResults.filter((item) => {
      const matchKeyword =
        !keyword || item.name.toLowerCase().includes(keyword.toLowerCase());
      const matchType = !credType || item.cred_type === credType;
      const matchShare = !share || getCredentialShare(item.cred_type) === share;
      return matchKeyword && matchType && matchShare;
    });
  }, [allResults, keyword, credType, share]);

  const stats = useMemo(() => {
    const total = allResults.length;
    const valid = allResults.filter(
      (i) => getCredentialStatus(i.is_active, i.expires_at) === 'valid'
    ).length;
    const nearExpiry = allResults.filter(
      (i) => getCredentialStatus(i.is_active, i.expires_at) === 'nearExpiry'
    ).length;
    const expired = allResults.filter(
      (i) => getCredentialStatus(i.is_active, i.expires_at) === 'expired'
    ).length;
    return { total, valid, nearExpiry, expired };
  }, [allResults]);

  const handleDelete = async (id: string) => {
    try {
      await credentialApi.deleteCredential(id);
      message.success('删除成功');
      refetch();
    } catch (error) {
      console.error(error);
    }
  };

  const handleSave = async (values: Partial<Credential>) => {
    try {
      if (editingCredential?.id) {
        await credentialApi.updateCredential(editingCredential.id, values);
      } else {
        await credentialApi.createCredential(values);
      }
      message.success('保存成功');
      setModalOpen(false);
      setEditingCredential(null);
      refetch();
    } catch (error) {
      console.error(error);
    }
  };

  const typeMenuItems = [
    { key: '', label: '全部类型' },
    ...credentialTypeOptions.map(([value, label]) => ({ key: value, label })),
  ];

  const shareMenuItems = [
    { key: '', label: '全部范围' },
    ...credentialShareOptions.map(([value, label]) => ({ key: value, label })),
  ];

  const statCards = [
    {
      label: '凭证总数',
      value: stats.total,
      icon: KeyRound,
      iconClass: 'icon-violet',
    },
    {
      label: '有效',
      value: stats.valid,
      icon: ShieldCheck,
      iconClass: 'icon-emerald',
    },
    {
      label: '即将过期',
      value: stats.nearExpiry,
      icon: ClockAlert,
      iconClass: 'icon-amber',
    },
    {
      label: '已过期',
      value: stats.expired,
      icon: ShieldX,
      iconClass: 'icon-rose',
    },
  ];

  return (
    <div className="space-y-5 page-fade-in">
      {/* 页面标题 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">凭证</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            集中管理 Git / SVN 访问凭证，AES 加密存储
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingCredential(null);
            setModalOpen(true);
          }}
          className="btn-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          新增凭证
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="tech-card tech-card-hover rounded-xl p-4 flex items-center gap-3"
            >
              <div
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-lg',
                  card.iconClass,
                ].join(' ')}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </div>
              <div>
                <div className="font-mono text-[20px] font-semibold tracking-tight text-slate-900">
                  {card.value}
                </div>
                <div className="text-[11px] text-slate-400">{card.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 列表卡片 */}
      <div className="tech-card rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-50 px-5 py-3">
          <div className="relative w-full sm:w-auto">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
              strokeWidth={1.5}
            />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索凭证名称"
              className="w-full sm:w-[220px] rounded-lg border border-indigo-100 bg-white pl-8 pr-3 py-1.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <Dropdown
            menu={{
              items: typeMenuItems,
              onClick: ({ key }) => setCredType(key as CredentialType | ''),
              selectable: true,
              selectedKeys: [credType || 'all'],
            }}
            trigger={['click']}
            placement="bottomLeft"
          >
            <button
              type="button"
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-[13px] transition-colors',
                credType
                  ? 'border-indigo-200 text-indigo-600 bg-indigo-50/40'
                  : 'border-indigo-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600',
              ].join(' ')}
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{credType ? credentialTypeMap[credType] : '类型'}</span>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </Dropdown>

          <Dropdown
            menu={{
              items: shareMenuItems,
              onClick: ({ key }) => setShare(key as CredentialShare | ''),
              selectable: true,
              selectedKeys: [share || 'all'],
            }}
            trigger={['click']}
            placement="bottomLeft"
          >
            <button
              type="button"
              className={[
                'inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-[13px] transition-colors',
                share
                  ? 'border-indigo-200 text-indigo-600 bg-indigo-50/40'
                  : 'border-indigo-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600',
              ].join(' ')}
            >
              <Layers className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{share ? credentialShareMap[share] : '范围'}</span>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </Dropdown>

          <div className="ml-auto text-[12px] text-slate-400">共 {filtered.length} 条</div>
        </div>

        {/* 表头 */}
        <div className="hidden md:grid grid-cols-12 gap-3 border-b border-indigo-50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <div className="col-span-3">名称</div>
          <div className="col-span-2">类型</div>
          <div className="col-span-2">范围</div>
          <div className="col-span-2">脱敏数据</div>
          <div className="col-span-2">状态</div>
          <div className="col-span-1 text-right">操作</div>
        </div>

        {/* 表体 */}
        <div className="divide-y divide-indigo-50/50 max-h-[calc(100vh-340px)] overflow-y-auto max-md:max-h-none max-md:divide-y-0 max-md:space-y-3 max-md:p-3">
          {isLoading ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-slate-400">暂无凭证数据</div>
          ) : (
            filtered.map((item) => {
              const status = getCredentialStatus(item.is_active, item.expires_at);
              const statusCfg = statusConfig[status];
              const itemShare = getCredentialShare(item.cred_type);
              const subText = `${credentialShareMap[itemShare]} · ${item.owner_name || item.username || '-'}`;
              const ownerLabel = item.owner_name || item.username || '-';
              return (
                <div
                  key={item.id}
                  onClick={() => navigate(`/credentials/${item.id}`)}
                  className="cursor-pointer transition-colors hover:bg-indigo-50/30 max-md:rounded-xl max-md:border max-md:border-indigo-100/70 max-md:bg-white max-md:p-4"
                >
                  {/* 桌面端网格行 */}
                  <div className="hidden grid-cols-12 items-center gap-3 px-5 py-3 md:grid">
                    <div className="col-span-12 md:col-span-3 flex items-center gap-2.5">
                      <CredentialIcon type={item.cred_type} size="sm" />
                      <div>
                        <div className="text-[13px] font-medium text-slate-900">{item.name}</div>
                        <div className="text-[10px] text-slate-400">{subText}</div>
                      </div>
                    </div>

                    <div className="col-span-6 md:col-span-2">
                      <TypeTag type={item.cred_type} />
                    </div>

                    <div className="col-span-6 max-md:hidden md:col-span-2">
                      <ScopeTag share={itemShare} />
                    </div>

                    <div className="col-span-12 max-md:hidden md:col-span-2 font-mono text-[11px] text-slate-500">
                      {item.masked_data}
                    </div>

                    <div className="col-span-6 md:col-span-2">
                      <StatusBadge status={status} />
                    </div>

                    <div className="col-span-6 md:col-span-1 flex items-center justify-end gap-1 max-md:mt-1.5 max-md:w-full"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/credentials/${item.id}`);
                        }}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors max-md:p-2.5"
                        title="查看"
                      >
                        <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                      <Popconfirm
                        title="确定删除该凭证？"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          handleDelete(item.id);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors max-md:p-2.5"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </Popconfirm>
                    </div>
                  </div>

                  {/* 移动端卡片（参考 ui-design/mobile-release.html） */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`} />
                        {statusCfg.label}
                      </span>
                      <TypeTag type={item.cred_type} />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="truncate text-[15px] font-semibold tracking-tight text-slate-900">
                        {item.name}
                      </span>
                      <span className="shrink-0 text-[12px] text-slate-400">{credentialShareMap[itemShare]}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <KeyRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                      <span className="truncate font-mono">{item.masked_data}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-indigo-50 pt-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                          style={{ background: getAvatarColor(ownerLabel) }}
                        >
                          {ownerLabel.charAt(0)}
                        </span>
                        <span className="truncate text-[12px] text-slate-500">{ownerLabel}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/credentials/${item.id}`);
                          }}
                          className="rounded-md p-2 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                          title="查看"
                        >
                          <Eye className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                        <Popconfirm
                          title="确定删除该凭证？"
                          onConfirm={(e) => {
                            e?.stopPropagation();
                            handleDelete(item.id);
                          }}
                          onCancel={(e) => e?.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                          </button>
                        </Popconfirm>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <CredentialModal
        open={modalOpen}
        credential={editingCredential}
        onCancel={() => {
          setModalOpen(false);
          setEditingCredential(null);
        }}
        onOk={handleSave}
      />
    </div>
  );
}
