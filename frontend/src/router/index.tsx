import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthLayout } from '@/layouts/AuthLayout';
import { MainLayout } from '@/layouts/MainLayout';
import Login from '@/pages/Login';
import { AuthGuard, PageLoader } from './components';
import {
  CommitAIReview,
  CommitAlertDetail,
  CommitDetail,
  CommitList,
  CredentialList,
  CredentialUsage,
  Dashboard,
  Jenkins,
  JenkinsLogDetail,
  Profile,
  ProjectDetail,
  ProjectList,
  ReleaseBoard,
  RepositoryList,
  SystemConfig,
  SystemLogList,
  SystemRoleList,
  SystemUserList,
  TagGenerator,
  Workflow,
} from './pages';

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
          { path: 'commits/alerts', element: <PageLoader><CommitAlertDetail /></PageLoader> },
          { path: 'commits/:id/ai-review', element: <PageLoader><CommitAIReview /></PageLoader> },
          { path: 'commits/:id', element: <PageLoader><CommitDetail /></PageLoader> },
          { path: 'commits', element: <PageLoader><CommitList /></PageLoader> },
          { path: 'tags', element: <PageLoader><TagGenerator /></PageLoader> },
          { path: 'jenkins', element: <PageLoader><Jenkins /></PageLoader> },
          { path: 'jenkins/logs/:buildId', element: <PageLoader><JenkinsLogDetail /></PageLoader> },
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
