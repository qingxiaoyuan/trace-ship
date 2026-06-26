import { App } from 'antd';

/**
 * 获取 antd App 组件提供的 message / modal / notification 实例。
 *
 * 使用此 hook 替代 message.success() / Modal.confirm() 等静态方法，
 * 可以正确消费 ConfigProvider 的主题上下文，避免 antd 的 warning。
 */
export function useAppMessage() {
  return App.useApp();
}
