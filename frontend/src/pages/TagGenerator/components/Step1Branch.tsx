import { Form, Select, Radio, Row, Col, Typography } from 'antd';
import { TsCard } from '@/components/TsCard';
import { blueColors } from '../constants';
import type { Step1BranchProps } from '../types';

const { Text } = Typography;

/** 步骤 1：选择产品与分支 */
export function Step1Branch({
  form,
  projectOptions,
  repositoryOptions,
  branchOptions,
  tagOptions,
}: Step1BranchProps) {
  return (
    <TsCard
      title={
        <div className="flex items-center justify-between">
          <span style={{ fontWeight: 600, fontSize: 16, color: blueColors.charcoal }}>
            步骤 1：选择产品与分支
          </span>
          <Text type="secondary" style={{ fontSize: 13, color: blueColors.muted }}>
            请确认发布来源
          </Text>
        </div>
      }
      style={{ borderColor: blueColors.border, borderRadius: 12 }}
    >
      <Form form={form} layout="vertical" className="max-w-3xl">
        <Row gutter={[24, 0]}>
          <Col xs={24} md={12}>
            <Form.Item name="project" label="产品" rules={[{ required: true }]}>
              <Select options={projectOptions} placeholder="选择产品" size="large" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="repository" label="仓库" rules={[{ required: true }]}>
              <Select
                options={repositoryOptions}
                placeholder="选择仓库"
                size="large"
                loading={repositoryOptions.length === 0}
                disabled={!projectOptions.find((p) => p.value === form.getFieldValue('project'))}
                notFoundContent={repositoryOptions.length === 0 ? '请先选择产品' : undefined}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="branch" label="分支" rules={[{ required: true }]}>
              <Select
                options={branchOptions}
                placeholder="选择分支"
                size="large"
                loading={branchOptions.length === 0}
                disabled={!form.getFieldValue('repository')}
                notFoundContent={branchOptions.length === 0 ? '请先选择仓库' : undefined}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="start_tag" label="起始 Tag">
              <Select
                options={tagOptions}
                placeholder="选择起始 Tag"
                size="large"
                allowClear
                disabled={!form.getFieldValue('repository')}
                notFoundContent={tagOptions.length === 0 ? '尚未发布过任何版本' : undefined}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="release_type" label="发布类型" rules={[{ required: true }]}>
              <Radio.Group size="large">
                <Radio value="formal">正式版本</Radio>
                <Radio value="rc">RC 版本</Radio>
                <Radio value="beta">Beta 版本</Radio>
              </Radio.Group>
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </TsCard>
  );
}
