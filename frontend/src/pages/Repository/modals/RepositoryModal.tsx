import { useEffect, useMemo } from "react";
import { Form, Input, Select, Button } from "antd";
import { GitBranch, Link } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { TsModal } from "@/components/TsModal";
import { projectApi } from "@/api/project";
import { credentialApi } from "@/api/credential";
import type { Repository, CredentialType } from "@/types";

interface RepositoryModalProps {
  open: boolean;
  repo: Repository | null;
  projectId?: string;
  onCancel: () => void;
  onOk: (values: Partial<Repository>) => void | Promise<void>;
}

// 仓库平台与凭证类型的对应关系，与后端 VENDOR_TO_CRED_TYPE 保持一致
const VENDOR_TO_CRED_TYPE: Record<string, CredentialType> = {
  gitlab: "gitlab_token",
};

export function RepositoryModal({
  open,
  repo,
  projectId,
  onCancel,
  onOk,
}: RepositoryModalProps) {
  const [form] = Form.useForm();

  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ["repository-modal-project", projectId],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
    enabled: open && !!projectId,
  });

  const vendor = Form.useWatch("vendor", form) as string;
  const expectedCredType = VENDOR_TO_CRED_TYPE[vendor || ""] || undefined;

  // 凭证均为个人凭证（SVN 类型全系统共享），按平台对应的凭证类型过滤
  const { data: credentialData, isLoading: credentialsLoading } = useQuery({
    queryKey: ["repo-credentials", expectedCredType],
    queryFn: () =>
      credentialApi.getCredentials({
        page_size: 1000,
        cred_type: expectedCredType || undefined,
      }),
    enabled: open && !!expectedCredType,
  });

  const projectOptions =
    projectData?.results.map((p) => ({ label: p.name, value: p.id })) || [];
  const credentialOptions = useMemo(
    () =>
      credentialData?.results.map((c) => ({
        label: `${c.name} (${c.cred_type})`,
        value: c.id,
        cred_type: c.cred_type,
      })) || [],
    [credentialData],
  );

  // 可选凭证变化后，若已选凭证不在新列表中则清空（切换来源/平台/产品或编辑回填不匹配时）
  useEffect(() => {
    const currentId = form.getFieldValue("credential_id");
    if (currentId && !credentialOptions.some((c) => c.value === currentId)) {
      form.setFieldsValue({ credential_id: undefined });
    }
  }, [credentialOptions, form]);

  useEffect(() => {
    if (open) {
      if (repo) {
        form.setFieldsValue({
          repo_type: repo.repo_type,
          vendor: repo.vendor,
          name: repo.name,
          // 编辑回填完整克隆地址（url 可能只存服务端根地址）
          url: repo.clone_url || repo.url,
          default_branch: repo.default_branch,
          credential_id: repo.credential_id,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          repo_type: "git",
          vendor: "gitlab",
          default_branch: "main",
        });
      }
    }
  }, [open, repo, projectId, form]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      const payload: Partial<Repository> & {
        project?: string;
        credential?: string;
      } = {
        ...values,
        ...(projectId ? { project: projectId } : {}),
        credential: values.credential_id,
        // 凭证统一为个人凭证（SVN 凭证全系统共享），credential_mode 固定为 personal
        credential_mode: "personal",
      };
      // 删除前端字段，避免污染后端
      delete (payload as Record<string, unknown>).credential_id;
      onOk(payload);
      form.resetFields();
    });
  };

  const confirmLoading = (projectId ? projectsLoading : false) || credentialsLoading;

  return (
    <TsModal
      title={repo ? "编辑仓库" : "新增仓库"}
      subtitle="登记可复用的物理代码仓库，版本与 Tag 归属仓库"
      titleIcon={<GitBranch className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      width={640}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button
            type="text"
            className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium text-slate-500 transition hover:text-slate-700"
            onClick={() => {
              form.resetFields();
              onCancel();
            }}
          >
            取消
          </Button>
          <Button
            type="primary"
            className="h-auto rounded-lg px-4 py-2 text-[13px] font-medium"
            onClick={handleOk}
            loading={confirmLoading}
          >
            确认
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        {/* 仓库类型 / 平台目前仅有 Git / GitLab 一个选项，隐藏字段仅保留表单值 */}
        <Form.Item name="repo_type" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="vendor" hidden>
          <Input />
        </Form.Item>

        {/* 基本信息 */}
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          基本信息
        </p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          {projectId ? (
            <Form.Item label="创建后关联产品" className="mb-0">
              <Input
                value={
                  projectOptions.find((p) => p.value === projectId)?.label ||
                  projectId
                }
                disabled
              />
            </Form.Item>
          ) : null}
          <Form.Item
            name="name"
            label="仓库名称"
            className="mb-0"
            rules={[{ required: true, message: "请输入仓库名称" }]}
          >
            <Input placeholder="请输入仓库名称" />
          </Form.Item>
          <Form.Item
            name="default_branch"
            label="默认分支"
            className="mb-0"
            rules={[{ required: true, message: "请输入默认分支" }]}
          >
            <Input
              prefix={<GitBranch className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
              placeholder="main"
            />
          </Form.Item>
          <Form.Item
            name="url"
            label="仓库地址"
            className="mb-0 sm:col-span-2"
            rules={[{ required: true, message: "请输入仓库地址" }]}
            extra={
              <p className="mb-0 mt-1 text-[11px] text-slate-400">
                支持填写完整克隆地址，保存后按平台自动解析
              </p>
            }
          >
            <Input
              prefix={<Link className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />}
              placeholder="https://gitlab.example.com/owner/repo.git"
              className="font-mono-ui"
            />
          </Form.Item>
        </div>

        <div className="my-5 h-px bg-[#EDEFF7]" />

        {/* 凭证配置 */}
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          凭证配置
        </p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <Form.Item
            name="credential_id"
            label="凭证"
            className="mb-0"
            rules={[{ required: true, message: "请选择凭证" }]}
            extra={
              <p className="mb-0 mt-1 text-[11px] text-slate-400">
                按仓库平台过滤可用凭证，凭证归个人所有
              </p>
            }
          >
            <Select
              showSearch
              placeholder="选择凭证"
              loading={credentialsLoading}
              options={credentialOptions}
              optionFilterProp="label"
              notFoundContent="暂无可用的凭证"
            />
          </Form.Item>
        </div>
      </Form>
    </TsModal>
  );
}
