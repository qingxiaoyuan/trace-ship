import { useQuery } from '@tanstack/react-query';
import { packageApi } from '@/api/package';
import type { AvailableImageItem, PackageImageInfo } from '@/types';

/** 把可选镜像条目转换为打包配置提交用的镜像坐标 */
export function toImageInfo(item: AvailableImageItem): PackageImageInfo {
  return {
    source: item.source,
    registry_host: item.registry_host || '',
    repository: item.repository || '',
    image_name: item.name,
    image_tag: item.version,
  };
}

/** 拉取可选打包镜像（本地 Docker + Nexus） */
export function useAvailableImages() {
  const { data, isLoading } = useQuery({
    queryKey: ['available-images', 'select'],
    queryFn: () => packageApi.getAvailableImages(),
    staleTime: 60_000,
  });
  return { items: data?.items || [], errors: data?.errors || {}, isLoading };
}
