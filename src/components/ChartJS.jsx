import React, { useRef, useEffect } from 'react';
import { Chart } from 'chart.js/auto';

export const ChartJS = ({ type, data, options = {}, height = 260 }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new Chart(canvasRef.current, {
      type,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1C1D28',
            titleColor: '#EEEEF0',
            bodyColor: '#9496A8',
            borderColor: '#252636',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
          },
        },
        ...options,
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [type, JSON.stringify(data), JSON.stringify(options)]);

  return (
    <div style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
};

