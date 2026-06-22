import { Descriptions } from 'antd';

export function OverviewTab() {
  return (
    <Descriptions bordered column={2}>
      <Descriptions.Item label="项目编码">CORE_TRADE</Descriptions.Item>
      <Descriptions.Item label="项目名称">核心交易平台</Descriptions.Item>
      <Descriptions.Item label="项目负责人">张三</Descriptions.Item>
      <Descriptions.Item label="版本号规则">{'VA.{major}.{minor}.{patch}'}</Descriptions.Item>
      <Descriptions.Item label="发布周期">3 天</Descriptions.Item>
      <Descriptions.Item label="正式发布分支">main</Descriptions.Item>
      <Descriptions.Item label="测试版本前缀">test</Descriptions.Item>
      <Descriptions.Item label="Commit 合规率阈值">90%</Descriptions.Item>
      <Descriptions.Item label="描述" span={2}>
        核心交易业务系统，承载公司主要交易链路。
      </Descriptions.Item>
    </Descriptions>
  );
}
