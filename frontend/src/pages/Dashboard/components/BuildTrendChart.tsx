import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js';
import { tokens } from '@/styles/theme';
import type { BuildTrendItem } from '../types';

/** 构建趋势柱状图（最近 7 天成功/失败） */
export function BuildTrendChart({ data }: { data: BuildTrendItem[] }) {
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
      type: 'bar',
      data: {
        labels: data.map((item) => item.day),
        datasets: [
          {
            label: '成功',
            data: data.map((item) => item.success),
            backgroundColor: '#10B981',
            borderRadius: 3,
            barPercentage: 0.6,
            categoryPercentage: 0.7,
          },
          {
            label: '失败',
            data: data.map((item) => item.failed),
            backgroundColor: '#F43F5E',
            borderRadius: 3,
            barPercentage: 0.6,
            categoryPercentage: 0.7,
          },
        ],
      },
      options: {
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
            titleFont: { size: 12, weight: 500, family: tokens.font.sans },
            bodyFont: { size: 12, family: tokens.font.sans },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: '#94A3B8', font: { size: 10, family: tokens.font.sans } },
          },
          y: {
            grid: { color: '#F1F5F9' },
            border: { display: false },
            ticks: { color: '#94A3B8', font: { size: 10, family: tokens.font.sans }, maxTicksLimit: 4 },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [data]);

  return (
    <div className="relative h-[160px]">
      <canvas ref={canvasRef} />
    </div>
  );
}
