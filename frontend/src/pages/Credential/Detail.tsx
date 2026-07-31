import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { message, Popconfirm } from "antd";
import {
  ChevronRight,
  Pencil,
  Layers,
  Calendar,
  Clock,
  Link,
  ShieldCheck,
  Eye,
  GitFork,
  Tag,
  GitCompare,
  Trash2,
} from "lucide-react";
import { credentialApi } from "@/api/credential";
import { repositoryApi } from "@/api/repository";
import type { Credential, Repository } from "@/types";
import { CredentialIcon } from "./components/CredentialIcon";
import { StatusBadge } from "./components/StatusBadge";
import { CredentialModal } from "./components/CredentialModal";
import { credentialTypeMap, credentialShareMap, getCredentialShare } from "./constants";
import { formatDate, fromNow, getCredentialStatus } from "./utils";

type TabKey = "info" | "usage" | "resources";

const usageIconMap: Record<
  string,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  repository: GitFork,
  release: Tag,
  default: GitCompare,
};

const usageResultConfig: Record<
  string,
  { border: string; bg: string; text: string; label: string }
> = {
  success: {
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    label: "成功",
  },
  failure: {
    border: "border-rose-200",
    bg: "bg-rose-50",
    text: "text-rose-600",
    label: "失败",
  },
};

export default function CredentialDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>("info");
  const [modalOpen, setModalOpen] = useState(false);

  const {
    data: credential,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["credential", id],
    queryFn: () => credentialApi.getCredential(id || ""),
    enabled: !!id,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ["credential-usage", id],
    queryFn: () => credentialApi.getUsage(id || "", { page_size: 1000 }),
    enabled: !!id && activeTab === "usage",
  });
  const { data: repoData } = useQuery({
    queryKey: ["credential-repositories", id],
    queryFn: () =>
      repositoryApi.getRepositories({ credential: id || "", page_size: 1000 }),
    enabled: !!id && activeTab === "resources",
  });

  const handleSave = async (values: Partial<Credential>) => {
    try {
      await credentialApi.updateCredential(id || "", values);
      message.success("保存成功");
      setModalOpen(false);
      refetch();
    } catch (error) {
      console.error(error);
    }
  };

  const handleDelete = async () => {
    try {
      await credentialApi.deleteCredential(id || "");
      message.success("删除成功");
      navigate("/credentials");
    } catch (error) {
      console.error(error);
    }
  };

  if (isLoading) {
    return (
      <div className="px-5 py-12 text-center text-[13px] text-slate-400">
        加载中…
      </div>
    );
  }

  if (!credential) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-[15px] font-medium text-slate-500">凭证不存在</div>
        <button
          type="button"
          onClick={() => navigate("/credentials")}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-1.5 text-[13px] text-slate-600 hover:bg-indigo-50 hover:text-indigo-600"
        >
          返回凭证列表
        </button>
      </div>
    );
  }

  const status = getCredentialStatus(
    credential.is_active,
    credential.expires_at,
  );
  const share = getCredentialShare(credential.cred_type);
  const subText = `${credentialShareMap[share]}凭证 · ${credential.owner_name || credential.username || "-"}`;

  const tabs: { key: TabKey; label: string }[] = [
    { key: "info", label: "凭证信息" },
    { key: "usage", label: "使用记录" },
    { key: "resources", label: "关联资源" },
  ];

  const usageRecords = (usageData?.results || []) as {
    id: string;
    module: string;
    action: string;
    description?: string;
    detail?: { module?: string; source_id?: string };
    used_at?: string;
    result?: string;
    created_at?: string;
  }[];

  const relatedRepos = (repoData?.results || []) as Repository[];
  const relatedCount = relatedRepos.length;

  return (
    <div className="space-y-5 page-fade-in">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          type="button"
          onClick={() => navigate("/credentials")}
          className="text-slate-400 hover:text-indigo-600 transition-colors"
        >
          凭证
        </button>
        <ChevronRight
          className="h-3.5 w-3.5 text-slate-300"
          strokeWidth={1.5}
        />
        <span className="font-medium text-slate-800">{credential.name}</span>
      </div>

      {/* 头部信息卡 */}
      <div className="tech-card rounded-xl p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <CredentialIcon type={credential.cred_type} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
                  {credential.name}
                </h1>
                <StatusBadge status={status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                <span className="rounded bg-slate-100 px-1 py-0.5 font-mono">
                  {credential.cred_type}
                </span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{subText}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* <button
              type="button"
              onClick={handleRotate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
              轮换
            </button> */}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              编辑
            </button>
            <Popconfirm title="确定删除该凭证？" onConfirm={handleDelete}>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-100 bg-white px-3 py-2 text-[13px] font-medium text-rose-500 hover:bg-rose-50 hover:border-rose-200 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                删除
              </button>
            </Popconfirm>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-indigo-50 pt-4 md:grid-cols-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-violet-500" strokeWidth={1.5} />
            <span className="text-[12px] text-slate-500">范围</span>
            <span className="text-[13px] font-semibold text-slate-900">
              {credentialShareMap[share]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-cyan-500" strokeWidth={1.5} />
            <span className="text-[12px] text-slate-500">过期</span>
            <span className="text-[13px] font-semibold text-slate-900">
              {formatDate(credential.expires_at, "永久有效")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />
            <span className="text-[12px] text-slate-500">最近使用</span>
            <span className="text-[13px] font-semibold text-slate-900">
              {fromNow(credential.last_used_at, "从未使用")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link className="h-4 w-4 text-emerald-500" strokeWidth={1.5} />
            <span className="text-[12px] text-slate-500">关联资源</span>
            <span className="text-[13px] font-semibold text-slate-900">
              {relatedCount} 个
            </span>
          </div>
        </div>
      </div>

      {/* Tab 卡片 */}
      <div className="tech-card rounded-xl overflow-hidden">
        <div className="flex items-center gap-1 border-b border-indigo-50 px-4 overflow-x-auto scrollbar-thin">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={[
                "dt-tab whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                activeTab === tab.key
                  ? "on text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-indigo-600",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {activeTab === "info" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-3">
                {[
                  { label: "凭证名称", value: credential.name },
                  {
                    label: "凭证类型",
                    value: credentialTypeMap[credential.cred_type],
                  },
                  { label: "认证方式", value: credential.auth_mode || "-" },
                  {
                    label: "范围",
                    value: credentialShareMap[share],
                  },
                  {
                    label: "创建时间",
                    value: formatDate(credential.created_at),
                  },
                  {
                    label: "过期时间",
                    value: formatDate(credential.expires_at, "永久有效"),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between py-2 border-b border-indigo-50 last:border-0"
                  >
                    <span className="text-[13px] text-slate-500">
                      {item.label}
                    </span>
                    <span className="text-[13px] text-slate-800">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] font-medium text-slate-600">
                      脱敏数据
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        message.info("明文需二次验证后查看，当前仅展示脱敏数据")
                      }
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-500 transition-colors"
                    >
                      <Eye className="h-3 w-3" strokeWidth={1.5} />
                      查看明文
                    </button>
                  </div>
                  <div className="rounded-lg border border-indigo-100 bg-slate-50/50 p-3 font-mono text-[12px] text-slate-600">
                    {credential.masked_data}
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 mb-1">
                    <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                    加密存储
                  </div>
                  <p className="text-[11px] text-slate-500">
                    凭证使用 AES-256
                    加密存储，接口仅返回脱敏数据，明文需二次验证后查看。
                  </p>
                </div>

                <div>
                  <div className="text-[12px] font-medium text-slate-600 mb-1.5">
                    权限范围
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {credential.cred_type === "gitlab_token" && (
                      <>
                        <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 font-mono">
                          read_repository
                        </span>
                        <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 font-mono">
                          api
                        </span>
                        <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 font-mono">
                          write_repository
                        </span>
                      </>
                    )}
                    {credential.cred_type !== "gitlab_token" && (
                      <span className="text-[12px] text-slate-400">
                        由具体凭证类型决定
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "usage" && (
            <div className="divide-y divide-indigo-50/50 border border-indigo-100 rounded-lg">
              {usageLoading ? (
                <div className="px-4 py-8 text-center text-[13px] text-slate-400">
                  加载中…
                </div>
              ) : usageRecords.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-slate-400">
                  暂无使用记录
                </div>
              ) : (
                usageRecords.map((record) => {
                  const Icon =
                    usageIconMap[record.module] || usageIconMap.default;
                  const resultCfg =
                    usageResultConfig[record.result || "success"];
                  return (
                    <div
                      key={record.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/20 transition-colors"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-indigo">
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-slate-900 truncate">
                    {record.detail?.module || record.module} · {record.action}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {record.description || `${credential.name}`}
                  </div>
                      </div>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">
                        {fromNow(record.created_at || record.used_at)}
                      </span>
                      <span
                        className={[
                          "rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
                          resultCfg.border,
                          resultCfg.bg,
                          resultCfg.text,
                        ].join(" ")}
                      >
                        {resultCfg.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === "resources" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {relatedRepos.map((repo) => (
                <div
                  key={repo.id}
                  onClick={() => navigate(`/repositories/${repo.id}`)}
                  className="rounded-lg border border-indigo-100 bg-white p-3 flex items-center gap-3 tech-card-hover transition-colors cursor-pointer"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg icon-cyan">
                    <GitFork className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-slate-900 truncate">
                      {repo.name}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      代码仓库 · {repo.project_name || '-'}
                    </div>
                  </div>
                </div>
              ))}

              {relatedRepos.length === 0 && (
                <div className="col-span-full text-center text-[13px] text-slate-400 py-8">
                  该凭证暂未绑定仓库资源
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <CredentialModal
        open={modalOpen}
        credential={credential}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
      />
    </div>
  );
}
