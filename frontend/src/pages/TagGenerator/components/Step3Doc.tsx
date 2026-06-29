import {
  Form,
  Input,
  Radio,
  Row,
  Col,
  Space,
  Typography,
  Divider,
  Button,
  Select,
  Checkbox,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { TsCard } from '@/components/TsCard';
import { blueColors } from '../constants';
import type { Step3DocProps } from '../types';
import { PreviewPanel } from './PreviewPanel';

const { Text, Title } = Typography;
const { TextArea } = Input;

/** 步骤 3：生成发布说明并提交 */
export function Step3Doc({
  form,
  version,
  gitHash,
  updates,
  relatedChanges,
  onAddUpdate,
  onUpdateChange,
  onRemoveUpdate,
  onRelatedChange,
}: Step3DocProps) {
  const impactOther = Form.useWatch('impact_other', form);

  return (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={16}>
        <TsCard
          title={
            <div className="flex items-center justify-between">
              <span style={{ fontWeight: 600, fontSize: 16, color: blueColors.charcoal }}>
                步骤 3：生成发布说明并提交
              </span>
              <Text type="secondary" style={{ fontSize: 13, color: blueColors.muted }}>
                编辑后提交审批
              </Text>
            </div>
          }
          style={{ borderColor: blueColors.border, borderRadius: 12 }}
        >
          <div
            style={{
              background: blueColors.canvas,
              border: `1px solid ${blueColors.border}`,
              borderRadius: 12,
              padding: '32px 40px',
            }}
          >
            <div
              style={{
                textAlign: 'center',
                borderBottom: `2px solid ${blueColors.charcoal}`,
                paddingBottom: 20,
                marginBottom: 32,
              }}
            >
              <Title level={4} style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.02em', color: blueColors.charcoal }}>
                软件发布规范
              </Title>
              <Text style={{ color: blueColors.muted, fontSize: 13 }}>Release Specification</Text>
            </div>

            <Form form={form} layout="vertical">
              <Row gutter={[24, 0]}>
                <Col xs={24} md={12}>
                  <Form.Item name="version" label="当前版本号" rules={[{ required: true }]}>
                    <Input placeholder="选择仓库与发布类型后自动生成" size="large" style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="tag_name" label="Tag 名称">
                    <Input placeholder="选择仓库与发布类型后自动生成" size="large" style={{ fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="git_hash" label="Git 提交哈希">
                    <Input
                      placeholder="选择来源分支后自动填充"
                      disabled
                      size="large"
                      style={{ fontFamily: '"SF Mono", "JetBrains Mono", monospace', background: blueColors.bone, color: blueColors.muted }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="change_type" label="变更类型">
                    <Radio.Group size="large">
                      <Radio value="none">无配置项改动</Radio>
                      <Radio value="config">有配置项改动</Radio>
                    </Radio.Group>
                  </Form.Item>
                </Col>
              </Row>

              <Divider style={{ borderColor: blueColors.border, margin: '28px 0' }} />

              <div style={{ marginBottom: 24 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                  <Text style={{ fontWeight: 600, color: blueColors.charcoal }}>更新内容</Text>
                  <Button
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={onAddUpdate}
                    style={{ borderColor: blueColors.border, color: blueColors.muted }}
                  >
                    新增一条
                  </Button>
                </div>
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  {updates.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3"
                      style={{
                        padding: '10px 12px',
                        background: blueColors.bone,
                        borderRadius: 8,
                        border: `1px solid ${blueColors.border}`,
                      }}
                    >
                      <span
                        style={{
                          color: blueColors.muted,
                          fontSize: 13,
                          fontFamily: '"SF Mono", monospace',
                          minWidth: 36,
                        }}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <Select
                        value={item.type}
                        onChange={(v) => onUpdateChange(item.id, 'type', v)}
                        options={[
                          { label: 'A类', value: 'A' },
                          { label: 'F类', value: 'F' },
                        ]}
                        style={{ width: 80 }}
                      />
                      <Input
                        value={item.content}
                        onChange={(e) => onUpdateChange(item.id, 'content', e.target.value)}
                        placeholder="更新内容"
                        style={{ flex: 1 }}
                      />
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => onRemoveUpdate(item.id)}
                        disabled={updates.length <= 1}
                      />
                    </div>
                  ))}
                </Space>
              </div>

              <Form.Item name="config_changes" label="配置项改动">
                <TextArea
                  rows={4}
                  placeholder="[System]\nDeviceType=0"
                  style={{ fontFamily: '"SF Mono", "JetBrains Mono", monospace', background: blueColors.bone }}
                />
              </Form.Item>

              <Divider style={{ borderColor: blueColors.border, margin: '28px 0' }} />

              <div style={{ marginBottom: 24 }}>
                <div style={{ marginBottom: 16 }}>
                  <Text style={{ fontWeight: 600, color: blueColors.charcoal }}>关联性改动</Text>
                  <Text style={{ color: blueColors.muted, fontSize: 13, marginLeft: 8 }}>[选填] 可修改软件名称与版本号</Text>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    gap: 12,
                  }}
                >
                  {relatedChanges.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3"
                      style={{
                        padding: '10px 12px',
                        background: blueColors.bone,
                        borderRadius: 8,
                        border: `1px solid ${blueColors.border}`,
                        animationDelay: `${index * 40}ms`,
                      }}
                    >
                      <Input
                        value={item.softwareName}
                        onChange={(e) => onRelatedChange(item.id, 'softwareName', e.target.value)}
                        placeholder="软件名称"
                        style={{
                          width: 180,
                          fontWeight: 500,
                          color: blueColors.charcoal,
                          background: blueColors.canvas,
                        }}
                      />
                      <span style={{ color: blueColors.muted, fontSize: 12, whiteSpace: 'nowrap' }}>版本</span>
                      <Input
                        value={item.version}
                        onChange={(e) => onRelatedChange(item.id, 'version', e.target.value)}
                        placeholder="版本号"
                        style={{ flex: 1, fontFamily: 'monospace' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <Form.Item name="impact_other" label="是否影响其他功能" initialValue={false}>
                <Radio.Group>
                  <Radio value={false}>否</Radio>
                  <Radio value={true}>是</Radio>
                </Radio.Group>
              </Form.Item>
              {impactOther && (
                <Form.Item name="impact_description" style={{ marginTop: -8 }}>
                  <Input placeholder="例：影响功率控制" />
                </Form.Item>
              )}

              <Form.Item name="test_status" label="测试验证">
                <Checkbox.Group
                  options={[
                    { label: '自测试通过', value: 'self_test' },
                    { label: '研发测试复验通过', value: 'dev_test' },
                  ]}
                />
              </Form.Item>

              <Form.Item name="publisher" label="发布人">
                <Input placeholder="发布人姓名" size="large" />
              </Form.Item>
            </Form>
          </div>
        </TsCard>
      </Col>

      <Col xs={24} lg={8}>
        <TsCard
          title={<span style={{ fontWeight: 600, fontSize: 15, color: blueColors.charcoal }}>实时预览</span>}
          style={{ borderColor: blueColors.border, borderRadius: 12 }}
        >
          <PreviewPanel version={version} gitHash={gitHash} updates={updates} relatedChanges={relatedChanges} />
        </TsCard>
      </Col>
    </Row>
  );
}
