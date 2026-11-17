import { useQuery } from '@tanstack/react-query';
import { softwareApi } from '@/api/software';
import { useAuthStore } from '@/stores/authStore';
import { fetchAllPages } from '@/pages/Package/components/boardData';

export function useMaintainedSoftware(enabled: boolean, project?: string) {
  const userId = useAuthStore((state) => state.user?.id);
  const directory = useQuery({
    queryKey: ['software-directory', userId, 'packaging'],
    queryFn: () => fetchAllPages((page) => softwareApi.list({ page })),
    enabled: enabled && !!userId,
  });
  const selected = useQuery({
    queryKey: ['project-software', userId, project, 'packaging-active'],
    queryFn: () => softwareApi.listProject(project!, true),
    enabled: enabled && !!project && !!userId,
  });
  const selectedIds = new Set(selected.data?.map((row) => row.software.id));
  return (directory.data?.results ?? []).filter(
    (software) => software.can_maintain && software.is_active && (!project || selectedIds.has(software.id)),
  );
}
