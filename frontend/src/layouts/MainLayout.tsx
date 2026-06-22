import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { tokens } from '@/styles/theme';

const { Content } = Layout;

export function MainLayout() {
  return (
    <Layout className="min-h-screen">
      <Sidebar />
      <Layout style={{ marginLeft: tokens.layout.sidebarWidth }}>
        <TopHeader />
        <Content
          style={{
            marginTop: tokens.layout.headerHeight,
            minHeight: 'calc(100vh - 64px)',
            padding: tokens.layout.pagePadding,
            background: tokens.colors.bg,
            overflow: 'auto',
          }}
        >
          <div className="page-fade-in">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
