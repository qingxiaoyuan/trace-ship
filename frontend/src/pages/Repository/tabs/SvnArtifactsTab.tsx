import { useQuery } from '@tanstack/react-query';
import { packageApi } from '@/api/package';
import { SvnArtifactsPanel } from '@/components/SvnArtifactsPanel';

interface SvnArtifactsTabProps {
  repoId: string;
}

/** SVN 制品 Tab：列出该仓库下启用 SVN 推送的打包配置，支持实时浏览制品目录 */
export function SvnArtifactsTab({ repoId }: SvnArtifactsTabProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['package-configs', 'repository', repoId],
    queryFn: () => packageApi.getConfigs({ repository: repoId, page_size: 1000 }),
    enabled: !!repoId,
  });

  const configs = (data?.results || []).filter((c) => c.svn_push_enabled && c.svn_url);

  return <SvnArtifactsPanel configs={configs} isLoading={isLoading} />;
}
