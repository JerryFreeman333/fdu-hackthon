/** 轻量 SVG 趋势图：画 21 天曲线 + 个人基线参考线，最后几天高亮 */
interface SparklineProps {
  values: Array<number | null>;
  baseline?: number;
  width?: number;
  height?: number;
  highlightLast?: number;
  decimals?: number;
}

export default function Sparkline({
  values,
  baseline,
  width = 260,
  height = 72,
  highlightLast = 3,
  decimals = 0,
}: SparklineProps) {
  const pad = 6;
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return <div className="spark-empty">暂无数据</div>;

  const lo = Math.min(...valid, baseline ?? Infinity);
  const hi = Math.max(...valid, baseline ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);

  const mainPath = values
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  const hlStart = values.length - highlightLast;
  const hlPath = values
    .slice(hlStart)
    .map((v, i) => (v === null ? null : `${x(hlStart + i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  const lastIdx = values.length - 1;
  const lastVal = values[lastIdx];

  return (
    <svg width={width} height={height} className="sparkline" role="img">
      {baseline !== undefined && (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="#9a8f82"
          strokeWidth={1.2}
          strokeDasharray="5 4"
        />
      )}
      <polyline points={mainPath} fill="none" stroke="#5b7a8c" strokeWidth={2} strokeLinejoin="round" />
      {hlPath && <polyline points={hlPath} fill="none" stroke="#d4694f" strokeWidth={2.6} strokeLinejoin="round" />}
      {lastVal !== null && (
        <>
          <circle cx={x(lastIdx)} cy={y(lastVal)} r={4} fill="#d4694f" />
          <text x={x(lastIdx) - 6} y={Math.max(y(lastVal) - 8, 12)} fontSize={12} fill="#8c4a38" textAnchor="end">
            {lastVal.toFixed(decimals)}
          </text>
        </>
      )}
    </svg>
  );
}
