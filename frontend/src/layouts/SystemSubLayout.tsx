import { Layout, Menu } from 'antd';
import type { ReactNode } from 'react';
import { tokens } from '@/styles/theme';

const { Sider, Content } = Layout;

interface SubLayoutItem {
  key: string;
  label: string;
}

interface SystemSubLayoutProps {
  title: string;
  activeKey: string;
  onChange: (key: string) => void;
  items: SubLayoutItem[];
  children: ReactNode;
}

export function SystemSubLayout({ title, activeKey, onChange, items, children }: SystemSubLayoutProps) {
  return (
    <Layout className="bg-transparent">
      <Sider
        width={176}
        style={{
          background: tokens.colors.surface,
          borderRadius: tokens.layout.cardRadius,
          border: `1px solid ${tokens.colors.border}`,
          overflow: 'hidden',
          marginRight: 16,
        }}
      >
        <div className="p-4 font-semibold border-b border-slate-100">{title}</div>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={items.map((item) => ({ key: item.key, label: item.label }))}
          onClick={({ key }) => onChange(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Content className="bg-transparent">{children}</Content>
    </Layout>
  );
}
