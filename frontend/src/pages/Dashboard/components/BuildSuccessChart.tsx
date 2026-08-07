import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js';
import { tokens } from '@/styles/theme';

/** 打包成功率环形图 */
export function BuildSuccessChart({
  rate,
  successCount,
  failureCount,
}: {
  rate: number;
  successCount: number;
  failureCount: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['成功', '失败'],
        datasets: [
          {
            data: [successCount, failureCount],
            backgroundColor: ['#10B981', '#F43F5E'],
            borderWidth: 0,
            borderRadius: 3,
            spacing: 2,
          },
        ],
      },
      options: {
        cutout: '75%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1E1B4B',
            titleColor: '#F1F5F9',
            bodyColor: '#C7D2FE',
            cornerRadius: 8,
            padding: 10,
            displayColors: true,
            boxPadding: 4,
            titleFont: { size: 12, weight: 500, family: tokens.font.sans },
            bodyFont: { size: 12, family: tokens.font.sans },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [successCount, failureCount]);

  return (
    <div className="relative flex items-center justify-center py-3">
      <div className="h-[180px] w-[180px]">
        <canvas ref={canvasRef} />
      </div>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-semibold tracking-tight text-gradient">
          {rate}
          <span className="text-[16px] text-slate-400">%</span>
        </span>
        <span className="mt-0.5 text-[11px] text-slate-400">成功率</span>
      </div>
    </div>
  );
}
