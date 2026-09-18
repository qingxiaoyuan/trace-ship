import { create } from 'zustand';

interface PageMetaState {
  /** 当前详情页实体名（如发布版本号、项目名），由详情页写入，顶栏面包屑追加展示 */
  entityTitle: string | null;
  setEntityTitle: (t: string | null) => void;
}

export const usePageMetaStore = create<PageMetaState>()((set) => ({
  entityTitle: null,
  setEntityTitle: (t) => set({ entityTitle: t }),
}));
