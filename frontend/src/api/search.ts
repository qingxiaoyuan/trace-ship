import { get } from './request';

/** 聚合搜索单条结果（后端 GET /api/search/ 返回） */
export interface SearchResultItem {
  id: string;
  name: string;
  subtitle?: string;
  /** 前端可直接跳转的路径 */
  path: string;
}

/** 聚合搜索分组结果；每组最多 5 条 */
export interface SearchResultGroups {
  projects?: SearchResultItem[];
  repositories?: SearchResultItem[];
  releases?: SearchResultItem[];
  workflows?: SearchResultItem[];
  packages?: SearchResultItem[];
}

export const searchApi = {
  /**
   * 全局聚合搜索。
   * 后端接口并行开发中，silent 避免 404 / 异常时全局 toast 打扰，
   * 调用方（命令面板）对失败静默降级为只展示静态功能入口。
   */
  search: (q: string) =>
    get<SearchResultGroups>('/search/', { params: { q }, silent: true }),
};
