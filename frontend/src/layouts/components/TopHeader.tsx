import { useMemo, useState } from 'react';
import {
  Layout,
  Breadcrumb,
  Badge,
  Avatar,
  Dropdown,
  Button,
  Typography,
  Space,
  List,
  Tabs,
} from 'antd';
import {
  BellOutlined,
  DownOutlined,
  LogoutOutlined,
  UserOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useLocation, useMatches, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tokens } from '@/styles/theme';
import { useAuthStore } from '@/stores/authStore';
import { notificationApi } from '@/api/notification';
import { mockProjects } from '@/mock/projects';
import { mockBuildRecords } from '@/mock/dashboard';

const { Header } = Layout;
const { Text } = Typography;

const typeMap: Record<string, string> = {
  audit: '审批',
  build: '构建',
  release: '发布',
  system: '系统',
};

export function TopHeader() {
  const location = useLocation();
  const matches = useMatches();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const queryClient = useQueryClient();
  const [bellOpen, setBellOpen] = useState(false);

  const { data: unreadCountData } = useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: () => notificationApi.getUnreadCount(),
  });

  const { data: notificationData } = useQuery({
    queryKey: ['header-notifications'],
    queryFn: () => notificationApi.getNotifications({ page_size: 5 }),
    enabled: bellOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['header-notifications'] });
    },
  });

  const unreadCount = unreadCountData?.count || 0;
  const notifications = notificationData?.results || [];

  const notificationMenu = {
    items: [
      {
        key: 'list',
        label: (
          <div style={{ width: 320 }}>
            <Tabs
              centered
              items={[
                {
                  key: 'unread',
                  label: `未读 (${unreadCount})`,
                  children: (
                    <List
                      size="small"
                      dataSource={notifications.filter((n) => !n.is_read)}
                      locale={{ emptyText: '暂无未读通知' }}
                      renderItem={(item) => (
                        <List.Item
                          actions={[
                            <Button
                              type="link"
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                markReadMutation.mutate(item.id);
                              }}
                            >
                              标记已读
                            </Button>,
                          ]}
                        >
                          <div className="cursor-pointer" onClick={() => navigate('/notifications')}>
                            <Text strong>[{typeMap[item.notification_type] || item.notification_type}] {item.title}</Text>
                            <div>
                              <Text type="secondary" ellipsis style={{ maxWidth: 240 }}>
                                {item.content}
                              </Text>
                            </div>
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
                {
                  key: 'recent',
                  label: '最近',
                  children: (
                    <List
                      size="small"
                      dataSource={notifications}
                      locale={{ emptyText: '暂无通知' }}
                      renderItem={(item) => (
                        <List.Item>
                          <div className="cursor-pointer" onClick={() => navigate('/notifications')}>
                            <Text type={item.is_read ? 'secondary' : undefined}>
                              [{typeMap[item.notification_type] || item.notification_type}] {item.title}
                            </Text>
                            <div>
                              <Text type="secondary" ellipsis style={{ maxWidth: 240 }}>
                                {item.content}
                              </Text>
                            </div>
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
            <div className="text-center pb-2">
              <Button type="link" onClick={() => navigate('/notifications')}>查看全部通知</Button>
            </div>
          </div>
        ),
      },
    ],
  };

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

    // 仓库详情动态面包屑：仓库管理 / 仓库详情
    const repoMatch = location.pathname.match(/^\/repositories\/([^/]+)/);
    if (repoMatch) {
      return [
        { title: '仓库管理', path: '/repositories' },
        { title: '仓库详情' },
      ];
    }

    // 凭证详情动态面包屑：凭证管理 / 凭证详情
    const credentialMatch = location.pathname.match(/^\/credentials\/([^/]+)/);
    if (credentialMatch) {
      return [
        { title: '凭证管理', path: '/credentials' },
        { title: '凭证详情' },
      ];
    }

    // 凭证使用记录动态面包屑：凭证管理 / 凭证详情 / 使用记录
    const credentialUsageMatch = location.pathname.match(/^\/credentials\/([^/]+)\/usage/);
    if (credentialUsageMatch) {
      return [
        { title: '凭证管理', path: '/credentials' },
        { title: '凭证详情', path: `/credentials/${credentialUsageMatch[1]}` },
        { title: '使用记录' },
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
        <Dropdown
          menu={notificationMenu}
          placement="bottomRight"
          arrow
          onOpenChange={(open) => setBellOpen(open)}
        >
          <Badge count={unreadCount} size="small" offset={[8, -4]}>
            <Button type="text" icon={<BellOutlined />} shape="circle" />
          </Badge>
        </Dropdown>

        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" arrow>
          <div className="flex items-center gap-2 cursor-pointer">
            <Avatar
              style={{ backgroundColor: tokens.colors.userAvatar }}
              size="small"
            >
              {(user?.nickname || user?.username)?.charAt(0) || 'U'}
            </Avatar>
            <div className="hidden md:flex flex-col leading-tight">
              <Text className="text-sm font-medium">{user?.nickname || user?.username || '未登录'}</Text>
              <Text className="text-xs text-slate-400">{user?.roles?.[0] || '用户'}</Text>
            </div>
            <DownOutlined className="text-xs text-slate-400" />
          </div>
        </Dropdown>
      </Space>
    </Header>
  );
}
