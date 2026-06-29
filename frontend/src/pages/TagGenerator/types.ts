import type { FormInstance } from 'antd';
import type { CommitRecord } from '@/types';

/** 关联性改动项 */
export interface RelatedChangeItem {
  id: string;
  softwareName: string;
  version: string;
}

/** 更新内容项 */
export interface UpdateItem {
  id: string;
  type: string;
  content: string;
}

/** 通用下拉选项 */
export interface Option {
  label: string;
  value: string;
}

/** 步骤 1：选择项目与分支 */
export interface Step1BranchProps {
  form: FormInstance;
  projectOptions: Option[];
  repositoryOptions: Option[];
  branchOptions: Option[];
  tagOptions: Option[];
}

/** 步骤 2：提取并编辑差异 */
export interface Step2DiffProps {
  commits: CommitRecord[];
  commitsLoading: boolean;
  selectedCommits: string[];
  toggleCommit: (id: string) => void;
  toggleAll: () => void;
}

/** 步骤 3：生成发布说明 */
export interface Step3DocProps {
  form: FormInstance;
  version?: string;
  gitHash?: string;
  updates: UpdateItem[];
  relatedChanges: RelatedChangeItem[];
  onAddUpdate: () => void;
  onUpdateChange: (id: string, key: 'type' | 'content', value: string) => void;
  onRemoveUpdate: (id: string) => void;
  onRelatedChange: (id: string, key: keyof RelatedChangeItem, value: string) => void;
}

/** 实时预览面板 */
export interface PreviewPanelProps {
  version?: string;
  gitHash?: string;
  updates: UpdateItem[];
  relatedChanges: RelatedChangeItem[];
}
