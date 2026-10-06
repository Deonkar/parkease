import { colors } from '@parkease/tokens';
import { Card, Empty } from 'antd';

import { formatInr } from '../../lib/money';

/**
 * Gross bookings per IST day — one bar per day, from the same ledger slice as the gross card.
 * Inline SVG rather than a chart library: one series, no interaction beyond a title per bar.
 */
export function GrossChart({ series }: { series: readonly { day: string; grossPaise: number }[] }) {
  const max = Math.max(1, ...series.map((p) => p.grossPaise));
  const width = 720;
  const height = 160;
  const gap = 2;
  const bar = series.length === 0 ? 0 : width / series.length - gap;

  return (
    <Card size="small" title="Gross bookings per day">
      {series.length === 0 ? (
        <Empty description="No bookings in this range." />
      ) : (
        <svg
          viewBox={`0 0 ${String(width)} ${String(height + 18)}`}
          width="100%"
          role="img"
          aria-label="Gross bookings per day"
        >
          {series.map((p, i) => {
            const h = Math.max(1, (p.grossPaise / max) * height);
            return (
              <rect
                key={p.day}
                x={i * (bar + gap)}
                y={height - h}
                width={bar}
                height={h}
                rx={2}
                fill={colors.primary}
              >
                <title>{`${p.day}: ${formatInr(p.grossPaise)}`}</title>
              </rect>
            );
          })}
          <text x={0} y={height + 14} fontSize={11} fill={colors.textSecondary}>
            {series[0]?.day}
          </text>
          <text
            x={width}
            y={height + 14}
            fontSize={11}
            fill={colors.textSecondary}
            textAnchor="end"
          >
            {series.at(-1)?.day}
          </text>
        </svg>
      )}
    </Card>
  );
}
