import { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Spin } from 'antd';
import { AuthLayout } from '@/layouts/AuthLayout';
import { MainLayout } from '@/layouts/MainLayout';
import Login from '@/pages/Login';
import { useAuthStore } from '@/stores/authStore';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const ProjectList = lazy(() => import('@/pages/Project/List'));
const ProjectDetail = lazy(() => import('@/pages/Project/Detail'));
const RepositoryList = lazy(() => import('@/pages/Repository/List'));
const CredentialList = lazy(() => import('@/pages/Credential/List'));
const CredentialUsage = lazy(() => import('@/pages/Credential/Usage'));
const CommitList = lazy(() => import('@/pages/Commit/List'));
const TagGenerator = lazy(() => import('@/pages/TagGenerator'));
const Jenkins = lazy(() => import('@/pages/Jenkins'));
const Workflow = lazy(() => import('@/pages/Workflow'));
const ReleaseBoard = lazy(() => import('@/pages/Release/Board'));
const SystemUserList = lazy(() => import('@/pages/System/UserList'));
const SystemRoleList = lazy(() => import('@/pages/System/RoleList'));
const SystemConfig = lazy(() => import('@/pages/System/Config'));
const SystemLogList = lazy(() => import('@/pages/System/LogList'));
const Profile = lazy(() => import('@/pages/Profile'));

function PageLoader({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function AuthGuard() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <AuthLayout>
        <Login />
      </AuthLayout>
    ),
  },
  {
    element: <AuthGuard />,
    children: [
      {
        path: '/',
        element: <MainLayout />,
        children: [
          { index: true, element: <PageLoader><Dashboard /></PageLoader> },
          { path: 'projects', element: <PageLoader><ProjectList /></PageLoader> },
          { path: 'projects/:id', element: <PageLoader><ProjectDetail /></PageLoader> },
          { path: 'projects/:id/:tab', element: <PageLoader><ProjectDetail /></PageLoader> },
          { path: 'repositories', element: <PageLoader><RepositoryList /></PageLoader> },
          { path: 'credentials', element: <PageLoader><CredentialList /></PageLoader> },
          { path: 'credentials/:id/usage', element: <PageLoader><CredentialUsage /></PageLoader> },
          { path: 'commits', element: <PageLoader><CommitList /></PageLoader> },
          { path: 'tags', element: <PageLoader><TagGenerator /></PageLoader> },
          { path: 'jenkins', element: <PageLoader><Jenkins /></PageLoader> },
          { path: 'workflows', element: <PageLoader><Workflow /></PageLoader> },
          { path: 'releases', element: <PageLoader><ReleaseBoard /></PageLoader> },
          { path: 'system/users', element: <PageLoader><SystemUserList /></PageLoader> },
          { path: 'system/roles', element: <PageLoader><SystemRoleList /></PageLoader> },
          { path: 'system/configs', element: <PageLoader><SystemConfig /></PageLoader> },
          { path: 'system/logs', element: <PageLoader><SystemLogList /></PageLoader> },
          { path: 'profile', element: <PageLoader><Profile /></PageLoader> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
