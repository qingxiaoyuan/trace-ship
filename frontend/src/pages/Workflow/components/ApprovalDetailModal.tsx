import { useState } from 'react';
import { Button, Input, Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  CheckOutlined,
  CloseOutlined,
  SwapOutlined,
  RollbackOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import { TsModal } from '@/components/TsModal';
import { accountApi } from '@/api/account';
import type { AccountUser } from '@/api/account';
import { tokens } from '@/styles/theme';
import type { WorkflowTask, WorkflowInstance } from '@/types';
import { ApprovalHistory } from './ApprovalHistory';

// 审批详情弹窗：展示发布信息、填写审批意见，并支持通过/驳回/转交/回退
export function ApprovalDetailModal({
  open,
  task,
  instance,
  onClose,
  onApprove,
  onReject,
  onTransfer,
  onRollback,
}: {
  open: boolean;
  task: WorkflowTask | null;
  instance: WorkflowInstance | null;
  onClose: () => void;
  onApprove: (comment: string) => void;
  onReject: (comment: string) => void;
  onTransfer: (toUserId: string, comment: string) => void;
  onRollback: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [transferMode, setTransferMode] = useState(false);
  const [rollbackMode, setRollbackMode] = useState(false);

  const { data: usersData } = useQuery({
    queryKey: ['users-for-transfer'],
    queryFn: () => accountApi.getUsers({ page_size: 1000 }),
    enabled: transferMode,
  });

  const releaseTypeText =
    task?.release_type === 'formal'
      ? '正式'
      : task?.release_type === 'rc'
      ? 'RC'
      : task?.release_type === 'beta'
      ? 'Beta'
      : '-';

  // 只有当前节点不是第一个审批节点时才允许回退
  const nodeConfig = instance?.definition
    ? (instance as unknown as { node_config?: { node_id: string }[] }).node_config
    : undefined;
  const currentNodeIndex = nodeConfig?.findIndex(
    (n) => n.node_id === task?.current_node,
  );
  const canRollback = (currentNodeIndex ?? 0) > 0;

  const resetModes = () => {
    setTransferMode(false);
    setRollbackMode(false);
  };

  return (
    <TsModal
      title={`审批详情：${task?.title ?? ''}`}
      open={open}
      onCancel={() => {
        resetModes();
        onClose();
      }}
      width={600}
      footer={
        <div className="flex justify-end gap-3">
          {transferMode ? (
            <>
              <Select
                placeholder="选择转交人"
                style={{ width: 160 }}
                value={toUserId || undefined}
                onChange={setToUserId}
                options={(usersData?.results || []).map((u: AccountUser) => ({
                  value: u.id,
                  label: `${u.nickname || u.username} (${u.username})`,
                }))}
              />
              <Button onClick={() => setTransferMode(false)}>取消</Button>
              <Button
                icon={<SwapOutlined />}
                onClick={() => {
                  onTransfer(toUserId, comment);
                  resetModes();
                }}
                disabled={!toUserId}
              >
                确认转交
              </Button>
            </>
          ) : rollbackMode ? (
            <>
              <Button onClick={() => setRollbackMode(false)}>取消</Button>
              <Button
                icon={<RollbackOutlined />}
                onClick={() => {
                  onRollback(comment);
                  resetModes();
                }}
                style={{
                  color: tokens.colors.warning,
                  borderColor: tokens.colors.warning,
                }}
              >
                确认回退
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => onApprove(comment)}
                icon={<CheckOutlined />}
                type="primary"
                style={{
                  background: tokens.colors.buttonPrimary,
                  borderColor: tokens.colors.buttonPrimary,
                  borderRadius: tokens.layout.buttonRadius,
                }}
              >
                通过
              </Button>
              <Button
                onClick={() => onReject(comment)}
                icon={<CloseOutlined />}
                style={{
                  color: tokens.colors.danger,
                  borderColor: tokens.colors.dangerSoft,
                  background: tokens.colors.dangerSoft,
                  borderRadius: tokens.layout.buttonRadius,
                }}
              >
                驳回
              </Button>
              {canRollback && (
                <Button
                  onClick={() => setRollbackMode(true)}
                  icon={<RollbackOutlined />}
                  style={{
                    borderColor: tokens.colors.border,
                    borderRadius: tokens.layout.buttonRadius,
                  }}
                >
                  回退
                </Button>
              )}
              <Button
                onClick={() => setTransferMode(true)}
                icon={<SwapOutlined />}
                style={{
                  borderColor: tokens.colors.border,
                  borderRadius: tokens.layout.buttonRadius,
                }}
              >
                转交
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="flex items-center mb-6">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mr-4"
          style={{
            background: tokens.colors.infoSoft,
            color: tokens.colors.info,
          }}
        >
          <NodeIndexOutlined className="text-xl" />
        </div>
        <div>
          <h4 className="font-bold" style={{ color: tokens.colors.textPrimary }}>
            审批详情：{task?.title}
          </h4>
          <p className="text-sm" style={{ color: tokens.colors.textSecondary }}>
            请核对发布信息并填写审批意见
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        {[
          { label: '版本号', value: task?.version || '-' },
          { label: '发布类型', value: releaseTypeText },
          { label: '来源分支', value: task?.source_branch || '-' },
          { label: '申请人', value: task?.applicant || '-' },
        ].map((item) => (
          <div
            key={item.label}
            className="p-4 rounded-xl border transition-colors"
            style={{
              background: tokens.colors.bg,
              borderColor: tokens.colors.border,
            }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: tokens.colors.textSecondary }}
            >
              {item.label}
            </div>
            <div
              className="text-sm font-semibold font-mono"
              style={{ color: tokens.colors.textPrimary }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-2">
        <label
          className="block text-sm font-medium mb-1.5"
          style={{ color: tokens.colors.textBody }}
        >
          审批意见
        </label>
        <Input.TextArea
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="请输入审批意见"
          style={{ borderRadius: tokens.layout.inputRadius }}
        />
      </div>

      {instance?.tasks && <ApprovalHistory tasks={instance.tasks} />}
    </TsModal>
  );
}
