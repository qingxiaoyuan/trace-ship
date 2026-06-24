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
import { useLocation, useMatches, useNavigate } from 'react-router-dom';
import { tokens } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { mockProjects } from '@/mock/projects';
import { mockBuildRecords } from '@/mock/dashboard';

const { Header } = Layout;
const { Text } = Typography;

const projectSelectOptions = mockProjects.map((p) => ({ value: p.id, label: p.name }));

export function TopHeader() {
  const location = useLocation();
  const matches = useMatches();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { currentProjectId, setCurrentProjectId } = useGlobalStore();

  const breadcrumbItems = useMemo<{ title: string; path?: string }[]>(() => {
    // 项目详情动态面包屑：项目管理 / 项目名称
    const projectMatch = location.pathname.match(/^\/projects\/([^/]+)/);
    if (projectMatch) {
      const project = mockProjects.find((p) => p.id === projectMatch[1]);
      return [
        { title: '项目管理', path: '/projects' },
        { title: project?.name || '项目详情' },
      ];
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

    // 通过路由 handle.title 生成面包屑
    const items: { title: string; path?: string }[] = [];
    matches.forEach((match, index) => {
      const title = (match.handle as { title?: string } | undefined)?.title;
      if (title) {
        items.push({
          title,
          path: index === matches.length - 1 ? undefined : match.pathname,
        });
      }
    });

    if (items.length === 0) {
      items.push({ title: '工作台' });
    }
    return items;
  }, [location.pathname, matches]);

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
