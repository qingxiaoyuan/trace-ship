import { useEffect, useRef } from 'react';
import LogicFlow from '@logicflow/core';
import '@logicflow/core/lib/style/index.css';
import type { WorkflowDefinition } from '@/types';

interface WorkflowFlowChartProps {
  graphData: WorkflowDefinition['graph_data'];
  height?: number;
}

/**
 * 把后端生成的自定义节点类型映射为 LogicFlow 内置类型，
 * 避免 LogicFlow 报"找不到 start-node 对应的节点"。
 */
function normalizeGraphData(data: WorkflowDefinition['graph_data']) {
  if (!data || !Array.isArray(data.nodes)) return data;

  const typeMap: Record<string, string> = {
    'start-node': 'circle',
    'approval-node': 'rect',
    'end-node': 'circle',
  };

  return {
    ...data,
    nodes: data.nodes.map((node) => ({
      ...node,
      type: typeMap[node.type] ?? node.type,
    })),
  };
}

export default function WorkflowFlowChart({ graphData, height = 280 }: WorkflowFlowChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lfRef = useRef<LogicFlow | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const lf = new LogicFlow({
      container: containerRef.current,
      width: containerRef.current.clientWidth,
      height,
      grid: { size: 10, visible: true, type: 'dot' },
      snapline: false,
      keyboard: { enabled: false },
      // 只读模式，禁用所有交互编辑
      isSilentMode: true,
    });

    lf.render(normalizeGraphData(graphData) as never);
    lfRef.current = lf;

    return () => {
      lf.destroy();
      lfRef.current = null;
    };
  }, [graphData, height]);

  return <div ref={containerRef} className="w-full bg-white rounded-lg border border-slate-200" />;
}
