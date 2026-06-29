import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { tokens } from '@/styles/theme';

const { Content } = Layout;

export function MainLayout() {
  return (
    <Layout className="relative min-h-screen bg-[#F6F7FB]">
      <div className="aurora-bg" />
      <Sidebar />
      <Layout
        className="relative z-10 min-h-screen bg-transparent lg:ml-[244px]"
        style={{ marginLeft: undefined }}
      >
        <TopHeader />
        <Content
          className="grid-bg"
          style={{
            minHeight: `calc(100vh - ${tokens.layout.headerHeight}px)`,
            background: 'transparent',
          }}
        >
          <div className="page-fade-in mx-auto max-w-[1400px] px-5 py-6 lg:px-7 lg:py-7">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
