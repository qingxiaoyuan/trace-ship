/**
 * 触发打包的目标配置（PackageConfig / 收藏配置均可，只需基础字段）。
 * 配置接口返回 project_id / repository_id；收藏卡片会映射到 project / repository。
 * 两套字段都缺失时，已发布 Tag 与分支下拉为空。
 */
export interface PackageTriggerTarget {
  id: string;
  name: string;
  repository_name?: string;
  project?: string;
  project_id?: string;
  repository?: string;
  repository_id?: string;
  svn_push_enabled?: boolean;
}

/** 解析触发打包所需的项目、仓库 ID（兼容接口字段与收藏卡片映射字段）。 */
export function resolvePackageTriggerScope(config?: PackageTriggerTarget | null): {
  projectId?: string;
  repositoryId?: string;
} {
  return {
    projectId: config?.project_id || config?.project,
    repositoryId: config?.repository_id || config?.repository,
  };
}
