import { useMemo } from 'react';
import type { PackageTask } from '@/types';

export function useLatestTaskByConfig(tasks: PackageTask[]) {
  return useMemo(() => {
    const map = new Map<string, PackageTask>();
    for (const task of tasks) {
      if (!task.config) continue;
      const existing = map.get(task.config);
      if (!existing || new Date(task.created_at) > new Date(existing.created_at)) {
        map.set(task.config, task);
      }
    }
    return map;
  }, [tasks]);
}
