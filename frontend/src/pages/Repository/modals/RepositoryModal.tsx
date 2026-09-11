import { useEffect, useMemo } from "react";
import { ConfigProvider, Form, Input, Select, Row, Col, Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { TsModal } from "@/components/TsModal";
import { FormSection } from "@/components/FormSection";
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
      open={open}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      width={720}
      footerStyle={{ background: 'transparent' }}
      footer={
        <div className="flex justify-end gap-3">
          <Button
            type="text"
            className="text-slate-500"
            onClick={() => {
              form.resetFields();
              onCancel();
            }}
          >
            取消
          </Button>
          <Button type="primary" onClick={handleOk} loading={confirmLoading}>
            确认
          </Button>
        </div>
      }
    >
      <ConfigProvider
        theme={{
          components: {
            Form: {
              itemMarginBottom: 0,
              verticalLabelPadding: 0,
            },
          },
        }}
      >
        <Form form={form} layout="vertical">
          <FormSection title="基本信息">
            <Row gutter={[24, 16]}>
              {projectId ? (
                <Col span={12}>
                  <Form.Item label="创建后关联产品">
                    <Input
                      value={
                        projectOptions.find((p) => p.value === projectId)
                          ?.label || projectId
                      }
                      disabled
                    />
                  </Form.Item>
                </Col>
              ) : null}
              <Col span={projectId ? 12 : 24}>
                <Form.Item
                  name="name"
                  label="仓库名称"
                  rules={[{ required: true, message: "请输入仓库名称" }]}
                >
                  <Input placeholder="请输入仓库名称" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="repo_type"
                  label="仓库类型"
                  rules={[{ required: true, message: "请选择仓库类型" }]}
                >
                  <Select
                    options={[
                      { label: "Git", value: "git" },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="vendor"
                  label="仓库平台"
                  rules={[{ required: true, message: "请选择仓库平台" }]}
                >
                  <Select
                    options={[
                      { label: "GitLab", value: "gitlab" },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item
                  name="url"
                  label="仓库地址"
                  rules={[{ required: true, message: "请输入仓库地址" }]}
                >
                  <Input placeholder="https://gitlab.example.com/owner/repo.git" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="default_branch"
                  label="默认分支"
                  rules={[{ required: true, message: "请输入默认分支" }]}
                >
                  <Input placeholder="main" />
                </Form.Item>
              </Col>
            </Row>
          </FormSection>

          <FormSection title="凭证配置">
            <Row gutter={[24, 16]}>
              <Col span={12}>
                <Form.Item
                  name="credential_id"
                  label="凭证"
                  rules={[{ required: true, message: "请选择凭证" }]}
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
              </Col>
            </Row>
          </FormSection>
        </Form>
      </ConfigProvider>
    </TsModal>
  );
}
