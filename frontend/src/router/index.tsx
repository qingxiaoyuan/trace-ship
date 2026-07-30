import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { AuthLayout } from '@/layouts/AuthLayout';
import { MainLayout } from '@/layouts/MainLayout';
import Login from '@/pages/Login';
import { AuthGuard, PageLoader } from './components';
import {
  BrowserUpgrade,
  CommitAlertDetail,
  CommitDetail,
  CommitList,
  CredentialDetail,
  CredentialList,
  Dashboard,
  Feedback,
  Guide,
  PackageImage,
  PackageTask,
  Notification,
  Profile,
  ProjectDetail,
  ProjectList,
  ReleaseBoard,
  ReleaseCreate,
  ReleaseDetail,
  RepositoryDetail,
  RepositoryList,
  SystemConfig,
  SystemLogList,
  SystemRoleList,
  SystemUserList,
  Workflow,
} from './pages';

interface AppRouteHandle {
  title?: string;
}

type AppRouteObject = RouteObject & {
  handle?: AppRouteHandle;
  children?: AppRouteObject[];
};

const routes: AppRouteObject[] = [
  {
    path: '/login',
    element: (
      <AuthLayout>
        <Login />
      </AuthLayout>
    ),
  },
  {
    path: '/browser-upgrade',
    element: (
      <PageLoader>
        <BrowserUpgrade />
      </PageLoader>
    ),
  },
  {
    element: <AuthGuard />,
    children: [
      {
        path: '/',
        element: <MainLayout />,
        children: [
          { index: true, element: <PageLoader><Dashboard /></PageLoader>, handle: { title: '工作台' } },
          { path: 'dashboard', element: <PageLoader><Dashboard /></PageLoader>, handle: { title: '工作台' } },
          { path: 'projects', element: <PageLoader><ProjectList /></PageLoader>, handle: { title: '项目管理' } },
          { path: 'projects/:id', element: <PageLoader><ProjectDetail /></PageLoader>, handle: { title: '项目详情' } },
          { path: 'projects/:id/:tab', element: <PageLoader><ProjectDetail /></PageLoader>, handle: { title: '项目详情' } },
          { path: 'repositories', element: <PageLoader><RepositoryList /></PageLoader>, handle: { title: '仓库管理' } },
          { path: 'repositories/:id', element: <PageLoader><RepositoryDetail /></PageLoader>, handle: { title: '仓库详情' } },
          { path: 'credentials', element: <PageLoader><CredentialList /></PageLoader>, handle: { title: '凭证管理' } },
          { path: 'credentials/:id', element: <PageLoader><CredentialDetail /></PageLoader>, handle: { title: '凭证详情' } },
          {
            path: 'commits',
            handle: { title: '提交规范审查' },
            children: [
              { index: true, element: <PageLoader><CommitList /></PageLoader> },
              { path: 'alerts', element: <PageLoader><CommitAlertDetail /></PageLoader>, handle: { title: '非法提交预警详情' } },
              { path: ':id', element: <PageLoader><CommitDetail /></PageLoader>, handle: { title: '查看详情' } },
            ],
          },
          { path: 'tags', element: <Navigate to="/releases/create" replace /> },
          { path: 'packages', element: <PageLoader><PackageTask /></PageLoader>, handle: { title: '打包看板' } },
          { path: 'packages/:id', element: <PageLoader><PackageTask /></PageLoader>, handle: { title: '打包看板' } },
          { path: 'workflows', element: <PageLoader><Workflow /></PageLoader>, handle: { title: '工作流审批' } },
          { path: 'releases', element: <PageLoader><ReleaseBoard /></PageLoader>, handle: { title: '发布看板' } },
          { path: 'releases/create', element: <PageLoader><ReleaseCreate /></PageLoader>, handle: { title: '新建发布' } },
          { path: 'releases/:id', element: <PageLoader><ReleaseDetail /></PageLoader>, handle: { title: '发布详情' } },
          { path: 'notifications', element: <PageLoader><Notification /></PageLoader>, handle: { title: '通知中心' } },
          { path: 'guide', element: <PageLoader><Guide /></PageLoader>, handle: { title: '使用说明' } },
          { path: 'feedback', element: <PageLoader><Feedback /></PageLoader>, handle: { title: '使用反馈' } },
          {
            path: 'system',
            handle: { title: '系统管理' },
            children: [
              { path: 'users', element: <PageLoader><SystemUserList /></PageLoader>, handle: { title: '用户管理' } },
              { path: 'roles', element: <PageLoader><SystemRoleList /></PageLoader>, handle: { title: '角色管理' } },
              { path: 'configs', element: <PageLoader><SystemConfig /></PageLoader>, handle: { title: '系统配置' } },
              { path: 'package-images', element: <PageLoader><PackageImage /></PageLoader>, handle: { title: '打包镜像' } },
              { path: 'logs', element: <PageLoader><SystemLogList /></PageLoader>, handle: { title: '操作日志' } },
            ],
          },
          { path: 'profile', element: <PageLoader><Profile /></PageLoader>, handle: { title: '个人中心' } },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes as RouteObject[]);
