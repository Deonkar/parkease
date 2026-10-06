import { BASIS_POINTS, type SurgeTier } from '@parkease/contracts/admin';
import { SURGE_BADGE_VALUES } from '@parkease/contracts/enums';
import { Button, InputNumber, Select, Table } from 'antd';

/**
 * The occupancy → multiplier ladder, shared by the global config and every zone override. The
 * first row is the 1.0× floor at 0% and is fixed; the API validates the rest (ascending, a badge
 * on every surging tier, the cap equal to a tier).
 */
export function TierLadderEditor({
  tiers,
  onChange,
}: {
  tiers: readonly SurgeTier[];
  onChange: (next: SurgeTier[]) => void;
}) {
  const edit = (i: number, patch: Partial<SurgeTier>) => {
    onChange(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  };
  const last = tiers.at(-1);

  return (
    <>
      <Table<SurgeTier & { key: number }>
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={tiers.map((t, key) => ({ ...t, key }))}
        columns={[
          {
            title: 'Occupancy above',
            render: (_, t, i) => (
              <InputNumber
                min={0}
                max={100}
                value={t.minOccupancyBp / 100}
                suffix="%"
                disabled={i === 0}
                onChange={(v) => {
                  edit(i, { minOccupancyBp: Math.round((v ?? 0) * 100) });
                }}
              />
            ),
          },
          {
            title: 'Multiplier',
            render: (_, t, i) => (
              <InputNumber
                min={1}
                max={5}
                step={0.05}
                value={t.multiplierBp / BASIS_POINTS}
                suffix="×"
                disabled={i === 0}
                onChange={(v) => {
                  edit(i, { multiplierBp: Math.round((v ?? 1) * BASIS_POINTS) });
                }}
              />
            ),
          },
          {
            title: 'Badge',
            render: (_, t, i) => (
              <Select
                style={{ width: 180 }}
                value={t.badge}
                disabled={i === 0}
                allowClear
                placeholder="—"
                options={SURGE_BADGE_VALUES.map((b) => ({
                  value: b,
                  label: b.replaceAll('_', ' '),
                }))}
                onChange={(b: SurgeTier['badge'] | undefined) => {
                  edit(i, { badge: b ?? null });
                }}
              />
            ),
          },
          {
            title: '',
            render: (_, _t, i) =>
              i === 0 ? null : (
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    onChange(tiers.filter((_, j) => j !== i));
                  }}
                >
                  Remove
                </Button>
              ),
          },
        ]}
      />
      <Button
        style={{ marginTop: 8 }}
        disabled={last === undefined}
        onClick={() => {
          if (last)
            onChange([
              ...tiers,
              {
                minOccupancyBp: Math.min(last.minOccupancyBp + 500, BASIS_POINTS),
                multiplierBp: last.multiplierBp + 2_500,
                badge: 'very_high_demand',
              },
            ]);
        }}
      >
        + add tier
      </Button>
    </>
  );
}
