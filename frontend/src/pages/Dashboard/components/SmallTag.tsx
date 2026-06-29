import type { ReactNode } from 'react';
import type { LucideIcon } from '../types';

/** 通用小标签：边框 + 浅底色 */
export function SmallTag({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

/** 图标容器：固定尺寸圆角方块 */
export function IconBox({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return (
    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${className}`}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
    </div>
  );
}

/** 首字母头像：取用户名首个字符，渐变背景 */
export function InitialAvatar({
  name,
  size = 20,
  ring = true,
}: {
  name?: string;
  size?: number;
  ring?: boolean;
}) {
  const initial = (name || '系').trim().charAt(0).toUpperCase();
  return (
    <span
      className={`flex items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 font-semibold text-white ${
        ring ? 'ring-2 ring-white' : ''
      }`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.45)) }}
    >
      {initial}
    </span>
  );
}
