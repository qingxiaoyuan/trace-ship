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

const credentialModeOptions = [
  { label: "项目凭证", value: "project" },
  { label: "个人凭证", value: "personal" },
];

// 仓库平台与凭证类型的对应关系，与后端 VENDOR_TO_CRED_TYPE 保持一致
const VENDOR_TO_CRED_TYPE: Record<string, CredentialType> = {
  gitlab: "gitlab_token",
  gitea: "gitea_token",
  github: "github_token",
  gitee: "gitea_token",
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

  const credentialMode = (Form.useWatch("credential_mode", form) || "project") as string;
  const vendor = Form.useWatch("vendor", form) as string;
  const watchedProjectId = (Form.useWatch("project_id", form) || projectId) as
    | string
    | undefined;
  const expectedCredType = VENDOR_TO_CRED_TYPE[vendor || ""] || undefined;

  // 按凭证来源拉取可选凭证：个人来源取自己的个人凭证，项目来源取挂靠在当前项目下的项目凭证
  const { data: credentialData, isLoading: credentialsLoading } = useQuery({
    queryKey: ["repo-credentials", credentialMode, watchedProjectId, expectedCredType],
    queryFn: () =>
      credentialApi.getCredentials({
        page_size: 1000,
        scope: credentialMode,
        cred_type: expectedCredType || undefined,
        project: credentialMode === "project" ? watchedProjectId : undefined,
      }),
    enabled:
      open &&
      !!credentialMode &&
      (credentialMode === "personal" || !!watchedProjectId) &&
      !!expectedCredType,
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

  // 可选凭证变化后，若已选凭证不在新列表中则清空（切换来源/平台/项目或编辑回填不匹配时）
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
          project_id: repo.project_id,
          repo_type: repo.repo_type,
          vendor: repo.vendor,
          name: repo.name,
          url: repo.url,
          default_branch: repo.default_branch,
          credential_mode: repo.credential_mode || "project",
          credential_id: repo.credential_id,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          project_id: projectId,
          repo_type: "git",
          vendor: "gitlab",
          default_branch: "main",
          credential_mode: "project",
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
        project: projectId || values.project_id,
        credential: values.credential_id,
      };
      // 删除前端字段，避免污染后端
      delete (payload as Record<string, unknown>).project_id;
      delete (payload as Record<string, unknown>).credential_id;
      onOk(payload);
      form.resetFields();
    });
  };

  const confirmLoading = projectsLoading || credentialsLoading;

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
                  label="凭证来源"
                  rules={[{ required: true, message: "请选择凭证来源" }]}
                >
                  <Select options={credentialModeOptions} />
                </Form.Item>
              </Col>
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
                    notFoundContent={
                      credentialMode === "personal"
                        ? "暂无可用的个人凭证"
                        : "暂无可用的项目凭证"
                    }
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
