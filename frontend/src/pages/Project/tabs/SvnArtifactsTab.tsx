import { useQuery } from '@tanstack/react-query';
import { packageApi } from '@/api/package';
import { SvnArtifactsPanel } from '@/components/SvnArtifactsPanel';

interface SvnArtifactsTabProps {
  projectId: string;
}

/** SVN 制品 Tab：按仓库分组列出项目下启用 SVN 推送的打包配置，支持实时浏览制品目录 */
export function SvnArtifactsTab({ projectId }: SvnArtifactsTabProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['package-configs', 'project-svn', projectId],
    queryFn: () => packageApi.getConfigs({ project: projectId, page_size: 1000 }),
    enabled: !!projectId,
  });

  const configs = (data?.results || []).filter((c) => c.svn_push_enabled && c.svn_url);

  return <SvnArtifactsPanel configs={configs} isLoading={isLoading} groupByRepo />;
}
