// 审批中心共享类型

import type { ReleaseType } from '@/types';

/**
 * 详情视图数据来源
 *
 * 列表行点击时构造，统一 task 与 instance 两种来源的字段，
 * 供详情视图渲染审批头、摘要与流程时间线。
 */
export interface DetailSource {
  /** 流程实例 ID，用于拉取实例详情（流程节点 / 审批历史） */
  instanceId: string;
  /** 审批任务 ID，仅待办行可审批时有值 */
  taskId?: string;
  title: string;
  version?: string;
  releaseType?: ReleaseType;
  branch?: string;
  buildNumber?: string | number;
  applicant: string;
  projectName: string;
  submitTime: string;
  currentNode: string;
  /** 审批模式：会签 all / 或签 any */
  mode?: 'any' | 'all';
  /** 只读：我发起的 / 已办 行不可审批 */
  readOnly: boolean;
}

/** 视图模式：列表 / 详情 */
export type ViewMode = 'list' | 'detail';
