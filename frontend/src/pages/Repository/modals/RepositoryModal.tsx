import { useEffect, useMemo } from "react";
import { ConfigProvider, Form, Input, Select, Row, Col, Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { TsModal } from "@/components/TsModal";
import { FormSection } from "@/components/FormSection";
import { projectApi } from "@/api/project";
import { credentialApi } from "@/api/credential";
import { accountApi } from "@/api/account";
import type { Repository } from "@/types";

interface RepositoryModalProps {
  open: boolean;
  repo: Repository | null;
  projectId?: string;
  onCancel: () => void;
  onOk: (values: Partial<Repository>) => void | Promise<void>;
}

const credentialModeOptions = [
  { label: "项目固定凭证", value: "fixed" },
  { label: "当前用户", value: "current_user" },
  { label: "指定用户", value: "specified_user" },
  { label: "系统全局凭证", value: "global" },
];

// 仓库平台与凭证类型的对应关系，与后端 VENDOR_TO_CRED_TYPE 保持一致
const VENDOR_TO_CRED_TYPE: Record<string, string> = {
  gitlab: "gitlab_token",
  gitea: "gitea_token",
  github: "github_token",
  gitee: "gitee_token",
  svn: "svn_password",
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
    queryKey: ["projects-all"],
    queryFn: () => projectApi.getProjects({ page_size: 1000 }),
    enabled: open,
  });

  const { data: credentialData, isLoading: credentialsLoading } = useQuery({
    queryKey: ["credentials-all"],
    queryFn: () => credentialApi.getCredentials({ page_size: 1000 }),
    enabled: open,
  });

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["account-users-all"],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: open,
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
  const userOptions =
    usersData?.results.map((u) => ({
      label: `${u.nickname || u.username} (${u.username})`,
      value: u.id,
    })) || [];

  const credentialMode = Form.useWatch("credential_mode", form);
  const vendor = Form.useWatch("vendor", form);
  const expectedCredType = VENDOR_TO_CRED_TYPE[vendor] || "";

  // 按平台过滤凭证选项，避免选错类型
  const filteredCredentialOptions = credentialOptions.filter(
    (c) => c.cred_type === expectedCredType,
  );

  // 平台切换时，如果已选凭证类型不匹配则清空
  useEffect(() => {
    const currentCredentialId = form.getFieldValue("credential_id");
    const currentCredential = credentialOptions.find(
      (c) => c.value === currentCredentialId,
    );
    if (currentCredential && currentCredential.cred_type !== expectedCredType) {
      form.setFieldsValue({ credential_id: undefined });
    }
  }, [vendor, credentialOptions, expectedCredType, form]);

  useEffect(() => {
    if (open) {
      if (repo) {
        form.setFieldsValue({
          project_id: repo.project_id,
          repo_type: repo.repo_type,
          vendor: repo.vendor,
          name: repo.name,
          url: repo.url,
          default_branch: repo.default_branch,
          credential_mode: repo.credential_mode || "fixed",
          credential_id: repo.credential_id,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          project_id: projectId,
          repo_type: "git",
          vendor: "gitlab",
          default_branch: "main",
          credential_mode: "fixed",
        });
      }
    }
  }, [open, repo, projectId, form]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      const payload: Partial<Repository> & {
        project?: string;
        credential?: string;
        specified_user?: string;
      } = {
        ...values,
        project: projectId || values.project_id,
        credential:
          values.credential_mode === "fixed" ? values.credential_id : undefined,
        specified_user:
          values.credential_mode === "specified_user"
            ? values.specified_user_id
            : undefined,
      };
      // 删除前端字段，避免污染后端
      delete (payload as Record<string, unknown>).project_id;
      delete (payload as Record<string, unknown>).credential_id;
      delete (payload as Record<string, unknown>).specified_user_id;
      onOk(payload);
      form.resetFields();
    });
  };

  const isFixed = credentialMode === "fixed";
  const isSpecifiedUser = credentialMode === "specified_user";
  const confirmLoading = projectsLoading || credentialsLoading || usersLoading;

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
              <Col span={12}>
                {!projectId ? (
                  <Form.Item
                    name="project_id"
                    label="关联项目"
                    rules={[{ required: true, message: "请选择项目" }]}
                  >
                    <Select
                      showSearch
                      placeholder="选择项目"
                      loading={projectsLoading}
                      options={projectOptions}
                      optionFilterProp="label"
                    />
                  </Form.Item>
                ) : (
                  <Form.Item label="关联项目">
                    <Input
                      value={
                        projectOptions.find((p) => p.value === projectId)
                          ?.label || projectId
                      }
                      disabled
                    />
                  </Form.Item>
                )}
              </Col>
              <Col span={12}>
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
                      { label: "SVN", value: "svn" },
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
                      { label: "Gitea", value: "gitea" },
                      { label: "GitHub", value: "github" },
                      { label: "Gitee", value: "gitee" },
                      { label: "SVN", value: "svn" },
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
                  <Input placeholder="https://gitea.example.com/owner/repo.git" />
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
                  name="credential_mode"
                  label="凭证模式"
                  rules={[{ required: true, message: "请选择凭证模式" }]}
                >
                  <Select options={credentialModeOptions} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    isFixed ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <Form.Item
                    name="credential_id"
                    label="凭证"
                    rules={[{ required: isFixed, message: "请选择凭证" }]}
                  >
                    <Select
                      showSearch
                      placeholder="选择凭证"
                      loading={credentialsLoading}
                      options={filteredCredentialOptions}
                      optionFilterProp="label"
                    />
                  </Form.Item>
                </div>
              </Col>
              <Col span={12}>
                <div
                  className={`overflow-hidden transition-all duration-300 ${
                    isSpecifiedUser
                      ? "max-h-40 opacity-100"
                      : "max-h-0 opacity-0"
                  }`}
                >
                  <Form.Item
                    name="specified_user_id"
                    label="指定用户"
                    rules={[
                      { required: isSpecifiedUser, message: "请选择指定用户" },
                    ]}
                  >
                    <Select
                      showSearch
                      placeholder="选择用户"
                      loading={usersLoading}
                      options={userOptions}
                      optionFilterProp="label"
                    />
                  </Form.Item>
                </div>
              </Col>
            </Row>
          </FormSection>
        </Form>
      </ConfigProvider>
    </TsModal>
  );
}
