import { useState, useEffect } from 'react';
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

const { Header } = Layout;
const { Text } = Typography;

const breadcrumbNameMap: Record<string, string> = {
  '/': '工作台',
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

const mockProjects = [
  { value: '1', label: '核心交易平台' },
  { value: '2', label: '数据中台' },
  { value: '3', label: '支付网关' },
];

export function TopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { currentProjectId, setCurrentProjectId } = useGlobalStore();
  const [breadcrumbItems, setBreadcrumbItems] = useState<{ title: string; path?: string }[]>([]);

  useEffect(() => {
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
    setBreadcrumbItems(items);
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
          options={mockProjects}
          style={{ width: 176 }}
          placeholder="选择项目"
        />

        <Badge dot color="red">
          <Button type="text" icon={<BellOutlined />} shape="circle" />
        </Badge>

        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" arrow>
          <div className="flex items-center gap-2 cursor-pointer">
            <Avatar
              style={{ backgroundColor: tokens.colors.primary }}
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
