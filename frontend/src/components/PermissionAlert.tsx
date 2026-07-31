import { Alert } from 'antd';
import type { NormalizedError } from '@/api/request';

interface PermissionAlertProps {
  /** 接口返回的错误对象（request.ts 已规范化），为空时不渲染 */
  error: unknown;
  /** 非权限错误时的标题，默认“加载失败” */
  errorTitle?: string;
  className?: string;
}

/**
 * 页面 / Tab 级错误警示组件
 *
 * 权限不足时展示警告提示并说明具体原因，其他错误展示错误提示，
 * 用于替代查询失败后静默的空白区域。
 */
export function PermissionAlert({ error, errorTitle = '加载失败', className }: PermissionAlertProps) {
  if (!error) return null;

  const normalized = error as Partial<NormalizedError>;
  const description =
    normalized.friendlyMessage || normalized.message || '请求失败，请稍后重试';

  if (normalized.isPermissionDenied) {
    return (
      <Alert
        type="warning"
        showIcon
        message="权限不足"
        description={description}
        className={className}
      />
    );
  }

  return (
    <Alert
      type="error"
      showIcon
      message={errorTitle}
      description={description}
      className={className}
    />
  );
}
