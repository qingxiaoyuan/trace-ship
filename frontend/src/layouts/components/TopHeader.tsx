import { useMemo, useState } from 'react';
import {
  Layout,
  Badge,
  Avatar,
  Dropdown,
  Button,
  Typography,
  List,
  Tabs,
} from 'antd';
import {
  Bell,
  ChevronRight,
  LogOut,
  Plus,
  Search,
  Settings,
  User,
} from 'lucide-react';
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
      icon: <User className="h-3.5 w-3.5" strokeWidth={1.5} />,
      label: '个人中心',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'settings',
      icon: <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />,
      label: '账号设置',
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />,
      label: '退出登录',
      danger: true,
      onClick: logout,
    },
  ];

  return (
    <Header
      className="sticky top-0 z-30 flex items-center gap-3 border-b border-indigo-100/60 bg-white/70 px-5 backdrop-blur-xl lg:px-7"
      style={{
        height: tokens.layout.headerHeight,
        paddingInline: undefined,
        lineHeight: undefined,
      }}
    >
      <div className="hidden items-center gap-1.5 text-[13px] md:flex">
        {breadcrumbItems.map((item, index) => (
          <div key={`${item.title}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <ChevronRight className="h-3.5 w-3.5 text-slate-300" strokeWidth={1.5} /> : null}
            {item.path ? (
              <button
                type="button"
                onClick={() => navigate(item.path!)}
                className="text-slate-400 transition-colors hover:text-indigo-600"
              >
                {item.title}
              </button>
            ) : (
              <span className="font-medium text-slate-800">{item.title}</span>
            )}
          </div>
        ))}
      </div>

      <div className="ml-auto hidden items-center md:flex">
        <button
          type="button"
          className="group flex w-[280px] items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-1.5 text-[13px] text-slate-400 transition-colors hover:border-indigo-200 hover:bg-white hover:text-indigo-600"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>搜索项目、发布、提交…</span>
          <span className="ml-auto flex items-center gap-0.5">
            <kbd className="rounded border border-indigo-100 bg-white px-1 py-0.5 text-[10px] font-medium text-slate-400">
              ⌘
            </kbd>
            <kbd className="rounded border border-indigo-100 bg-white px-1 py-0.5 text-[10px] font-medium text-slate-400">
              K
            </kbd>
          </span>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1 md:ml-0">
        <button
          type="button"
          onClick={() => navigate('/releases/create')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          aria-label="新建发布"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
        </button>

        <Dropdown
          menu={notificationMenu}
          placement="bottomRight"
          arrow
          onOpenChange={(open) => setBellOpen(open)}
        >
          <Badge count={unreadCount} size="small" offset={[-2, 4]}>
            <button
              type="button"
              className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
              aria-label="通知"
            >
              <Bell className="h-4 w-4" strokeWidth={1.5} />
              {unreadCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-cyan-400 ring-2 ring-white" />
              ) : null}
            </button>
          </Badge>
        </Dropdown>

        <div className="mx-1 h-5 w-px bg-indigo-100" />

        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" arrow>
          <button type="button" className="flex items-center gap-2 rounded-lg">
            <Avatar
              style={{
                background: `linear-gradient(135deg, ${tokens.colors.primaryLight}, ${tokens.colors.cyan})`,
                boxShadow: '0 0 0 1px #C7D2FE',
              }}
              size={32}
            >
              {(user?.nickname || user?.username)?.charAt(0) || 'U'}
            </Avatar>
          </button>
        </Dropdown>
      </div>
    </Header>
  );
}
