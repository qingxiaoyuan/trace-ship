import { useMemo } from 'react';
import {
  Layout,
  Breadcrumb,
  Select,
  Badge,
  Avatar,
  Dropdown,
  Button,
  Typography,
  Space,
} from 'antd';
import {
  BellOutlined,
  DownOutlined,
  LogoutOutlined,
  UserOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { tokens } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { mockProjects } from '@/mock/projects';
import { mockBuildRecords } from '@/mock/dashboard';

const { Header } = Layout;
const { Text } = Typography;

const breadcrumbNameMap: Record<string, string> = {
  '/': '首页',
  '/dashboard': '首页',
  '/projects': '项目管理',
  '/repositories': '仓库管理',
  '/credentials': '凭证管理',
  '/commits': '提交规范审查',
  '/tags': 'Tag 生成与发布',
  '/jenkins': 'Jenkins 构建',
  '/workflows': '工作流审批',
  '/releases': '发布看板',
  '/system': '系统管理',
  '/system/users': '用户管理',
  '/profile': '个人中心',
};

const projectSelectOptions = mockProjects.map((p) => ({ value: p.id, label: p.name }));

export function TopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { currentProjectId, setCurrentProjectId } = useGlobalStore();

  const breadcrumbItems = useMemo<{ title: string; path?: string }[]>(() => {
    // 项目详情动态面包屑：项目管理 / 项目名称
    const projectMatch = location.pathname.match(/^\/projects\/([^/]+)/);
    if (projectMatch) {
      const project = mockProjects.find((p) => p.id === projectMatch[1]);
      if (project) {
        return [
          { title: '项目管理', path: '/projects' },
          { title: project.name },
        ];
      }
    }

    // Jenkins 构建日志动态面包屑：Jenkins 构建 / 构建日志 #128
    const jenkinsLogMatch = location.pathname.match(/^\/jenkins\/logs\/([^/]+)/);
    if (jenkinsLogMatch) {
      const build = mockBuildRecords.find((b) => b.id === jenkinsLogMatch[1]);
      return [
        { title: 'Jenkins 构建', path: '/jenkins' },
        { title: build ? `构建日志 #${build.build_number}` : '构建日志' },
      ];
    }

    // 提交规范审查子路由动态面包屑
    const commitAiReviewMatch = location.pathname.match(/^\/commits\/([^/]+)\/ai-review/);
    if (commitAiReviewMatch) {
      return [
        { title: '提交规范审查', path: '/commits' },
        { title: 'AI 审查详情' },
      ];
    }

    if (location.pathname === '/commits/alerts') {
      return [
        { title: '提交规范审查', path: '/commits' },
        { title: '非法提交预警详情' },
      ];
    }

    if (location.pathname === '/releases') {
      return [
        { title: '工作台', path: '/' },
        { title: '发布看板' },
      ];
    }

    const commitDetailMatch = location.pathname.match(/^\/commits\/([^/]+)/);
    if (commitDetailMatch) {
      return [
        { title: '提交规范审查', path: '/commits' },
        { title: '查看详情' },
      ];
    }

    const pathSnippets = location.pathname.split('/').filter((i) => i);
    const items: { title: string; path?: string }[] = [];
    let currentPath = '';
    pathSnippets.forEach((_, index) => {
      currentPath += `/${pathSnippets[index]}`;
      const name = breadcrumbNameMap[currentPath];
      if (name) {
        items.push({
          title: name,
          path: index === pathSnippets.length - 1 ? undefined : currentPath,
        });
      }
    });

    if (items.length === 0) {
      items.push({ title: '工作台' });
    }
    return items;
  }, [location.pathname]);

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '账号设置',
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: logout,
    },
  ];

  return (
    <Header
      className="flex items-center justify-between px-6 fixed top-0 right-0 z-50"
      style={{
        left: tokens.layout.sidebarWidth,
        height: tokens.layout.headerHeight,
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${tokens.colors.border}`,
      }}
    >
      <Breadcrumb
        items={breadcrumbItems.map((item, index) => ({
          title: item.path ? (
            <a onClick={() => navigate(item.path!)} className="cursor-pointer">
              {item.title}
            </a>
          ) : (
            <span className="font-semibold text-slate-900">{item.title}</span>
          ),
          key: index,
        }))}
      />

      <Space size="middle">
        <Select
          value={currentProjectId || '1'}
          onChange={setCurrentProjectId}
          options={projectSelectOptions}
          style={{ width: 176 }}
          placeholder="选择项目"
        />

        <Badge dot color="red">
          <Button type="text" icon={<BellOutlined />} shape="circle" />
        </Badge>

        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" arrow>
          <div className="flex items-center gap-2 cursor-pointer">
            <Avatar
              style={{ backgroundColor: tokens.colors.userAvatar }}
              size="small"
            >
              {user?.nickname?.charAt(0) || 'U'}
            </Avatar>
            <div className="hidden md:flex flex-col leading-tight">
              <Text className="text-sm font-medium">{user?.nickname || '未登录'}</Text>
              <Text className="text-xs text-slate-400">{user?.roles?.[0] || '用户'}</Text>
            </div>
            <DownOutlined className="text-xs text-slate-400" />
          </div>
        </Dropdown>
      </Space>
    </Header>
  );
}
