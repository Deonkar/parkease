import {
  BASIS_POINTS,
  DEFAULT_SURGE_TIERS,
  surgeConfigSchema,
  surgeSnapshotSchema,
  surgeTierSchema,
  type SurgeConfig,
  type SurgeTier,
} from '@parkease/contracts/admin';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Typography,
} from 'antd';
import { useState } from 'react';
import { z } from 'zod';

import { PageState, errorText } from '../../components/data';
import { intentKey, useAction, useApi } from '../../lib/api';
import { formatIst } from '../../lib/money';

import { HeatMap } from './HeatMap';
import { TierLadderEditor } from './TierLadderEditor';

const x = (bp: number): string => `${(bp / BASIS_POINTS).toFixed(2)}×`;
const pct = (bp: number): string => `${(bp / 100).toFixed(0)}%`;
const toBp = (v: number | null): number => Math.round((v ?? 1) * BASIS_POINTS);

const configRecordSchema = surgeConfigSchema.and(z.object({ updatedAt: z.string() }));
const zoneSchema = z
  .object({
    zoneId: z.string(),
    label: z.string(),
    enabled: z.boolean(),
    maxMultiplierBp: z.number().int().nullable().optional(),
    tiers: z.array(surgeTierSchema).nullable().optional(),
    live: surgeSnapshotSchema,
  })
  .passthrough();
type Zone = z.infer<typeof zoneSchema>;

export function SurgePage() {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Surge
      </Typography.Title>
      <HeatMap />
      <GlobalConfig />
      <ZoneOverrides />
    </Space>
  );
}

function GlobalConfig() {
  const q = useApi(configRecordSchema, '/admin/surge/config');
  const [draft, setDraft] = useState<SurgeConfig | null>(null);
  const [key, setKey] = useState(intentKey);
  const save = useAction(z.unknown(), (body: SurgeConfig) => ({
    path: '/admin/surge/config',
    method: 'PUT',
    body,
  }));
  const config = draft ?? q.data?.data ?? null;
  const edit = (patch: Partial<SurgeConfig>) => {
    if (config) setDraft({ ...config, ...patch });
  };

  return (
    <Card
      title="Global configuration"
      extra={
        q.data ? (
          <Typography.Text type="secondary">
            last changed {formatIst(q.data.data.updatedAt)}
          </Typography.Text>
        ) : null
      }
    >
      <PageState
        isLoading={q.isLoading}
        error={q.error}
        isEmpty={false}
        emptyText=""
        onRetry={() => void q.refetch()}
      >
        {config ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <TierLadderEditor
              tiers={config.tiers}
              onChange={(tiers) => {
                edit({ tiers });
              }}
            />
            <Form layout="inline">
              <Form.Item label="Peak">
                <InputNumber
                  step={0.05}
                  value={config.peakHourModifierBp / BASIS_POINTS}
                  onChange={(v) => {
                    edit({ peakHourModifierBp: toBp(v) });
                  }}
                />
              </Form.Item>
              <Form.Item label="Weekend">
                <InputNumber
                  step={0.05}
                  value={config.weekendModifierBp / BASIS_POINTS}
                  onChange={(v) => {
                    edit({ weekendModifierBp: toBp(v) });
                  }}
                />
              </Form.Item>
              <Form.Item label="Event">
                <InputNumber
                  step={0.05}
                  value={config.eventModifierBp / BASIS_POINTS}
                  onChange={(v) => {
                    edit({ eventModifierBp: toBp(v) });
                  }}
                />
              </Form.Item>
              <Form.Item label="Cap">
                <InputNumber
                  step={0.05}
                  value={config.maxMultiplierBp / BASIS_POINTS}
                  suffix="×"
                  onChange={(v) => {
                    edit({ maxMultiplierBp: toBp(v) });
                  }}
                />
              </Form.Item>
              <Form.Item label="Window">
                <InputNumber
                  min={15}
                  value={config.occupancyWindowMinutes}
                  suffix="min"
                  onChange={(v) => {
                    edit({ occupancyWindowMinutes: v ?? 60 });
                  }}
                />
              </Form.Item>
            </Form>
            <Alert
              type="info"
              showIcon
              message="Modifiers only move a zone up to the next tier in the ladder; the cap must equal a tier multiplier. Saved changes apply on the next surge.recalculate cycle (within 5 minutes); prices already quoted do not change."
            />
            {save.error ? <Alert type="error" showIcon message={errorText(save.error)} /> : null}
            <Space>
              <Button
                disabled={draft === null}
                onClick={() => {
                  setDraft(null);
                }}
              >
                Discard
              </Button>
              <Button
                type="primary"
                disabled={draft === null}
                loading={save.isPending}
                onClick={() => {
                  if (draft)
                    save.mutate(
                      { vars: draft, key },
                      {
                        onSuccess: () => {
                          setDraft(null);
                          setKey(intentKey());
                        },
                      },
                    );
                }}
              >
                Save config
              </Button>
            </Space>
          </Space>
        ) : null}
      </PageState>
    </Card>
  );
}

function ZoneOverrides() {
  const q = useApi(z.array(zoneSchema), '/admin/surge/zones');
  const [editing, setEditing] = useState<Zone | 'new' | null>(null);
  const toggle = useAction(
    z.unknown(),
    ({ zoneId, enabled }: { zoneId: string; enabled: boolean }) => ({
      path: `/admin/surge/zones/${zoneId}`,
      method: 'PATCH',
      body: { enabled, reason: enabled ? 'enabled from admin panel' : 'disabled from admin panel' },
    }),
  );
  const zones = q.data?.data ?? [];
  return (
    <Card
      title="Zone overrides"
      extra={
        <Button
          onClick={() => {
            setEditing('new');
          }}
        >
          Add override
        </Button>
      }
    >
      {toggle.error ? (
        <Alert
          type="error"
          showIcon
          message={errorText(toggle.error)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <PageState
        isLoading={q.isLoading}
        error={q.error}
        isEmpty={zones.length === 0}
        emptyText="No zone overrides — every zone follows the global ladder."
        onRetry={() => void q.refetch()}
      >
        <Table<Zone>
          rowKey="zoneId"
          size="small"
          pagination={false}
          dataSource={zones}
          scroll={{ x: 720 }}
          columns={[
            {
              title: 'Zone',
              dataIndex: 'zoneId',
              render: (zone: string) => <Typography.Text code>{zone}</Typography.Text>,
            },
            { title: 'Label', dataIndex: 'label' },
            {
              title: 'Cap',
              render: (_, zone) => (zone.maxMultiplierBp ? x(zone.maxMultiplierBp) : 'inherited'),
            },
            {
              title: 'Tiers',
              render: (_, zone) =>
                zone.tiers ? `custom (${String(zone.tiers.length)})` : 'inherited',
            },
            {
              title: 'Now',
              render: (_, zone) => (
                <>
                  {x(zone.live.multiplierBp)}{' '}
                  <Typography.Text type="secondary">
                    at {pct(zone.live.occupancyBp)} occupied
                  </Typography.Text>
                </>
              ),
            },
            {
              title: 'Enabled',
              render: (_, zone) => (
                <Switch
                  checked={zone.enabled}
                  loading={toggle.isPending}
                  onChange={(enabled) => {
                    toggle.mutate({ vars: { zoneId: zone.zoneId, enabled }, key: intentKey() });
                  }}
                />
              ),
            },
            {
              title: '',
              render: (_, zone) => (
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(zone);
                  }}
                >
                  Edit
                </Button>
              ),
            },
          ]}
        />
      </PageState>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        An override cap may exceed the global cap — that is the point of an override — but it must
        ship with a ladder containing that multiplier and a badge, or the save is rejected.
      </Typography.Paragraph>
      {editing === null ? null : (
        <ZoneDialog
          zone={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

/** Create or edit an override: its label, cap and its own ladder (optional — none inherits). */
function ZoneDialog({ zone, onClose }: { zone: Zone | null; onClose: () => void }) {
  const [zoneId, setZoneId] = useState(zone?.zoneId ?? '');
  const [label, setLabel] = useState(zone?.label ?? '');
  const [reason, setReason] = useState('');
  const [cap, setCap] = useState<number | null>(zone?.maxMultiplierBp ?? null);
  const [tiers, setTiers] = useState<SurgeTier[] | null>(zone?.tiers ?? null);
  const [key] = useState(intentKey);
  const save = useAction(z.unknown(), () => {
    const body = {
      label,
      reason,
      ...(cap === null ? {} : { maxMultiplierBp: cap }),
      ...(tiers === null ? {} : { tiers }),
    };
    return zone === null
      ? { path: '/admin/surge/zones', body: { zoneId, ...body } }
      : { path: `/admin/surge/zones/${zone.zoneId}`, method: 'PATCH' as const, body };
  });
  const validZone = /^[0-9b-hjkmnp-z]{6}$/.test(zoneId);

  return (
    <Modal
      open
      width="min(760px, 100vw)"
      title={zone === null ? 'Add zone override' : `Edit override — ${zone.zoneId}`}
      okText="Save"
      confirmLoading={save.isPending}
      onCancel={onClose}
      okButtonProps={{ disabled: !validZone || label.trim() === '' || reason.trim() === '' }}
      onOk={() => {
        save.mutate({ vars: undefined, key }, { onSuccess: onClose });
      }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Input
          prefix="Zone"
          placeholder="6-character geohash"
          value={zoneId}
          disabled={zone !== null}
          onChange={(e) => {
            setZoneId(e.target.value.trim());
          }}
          status={zoneId === '' || validZone ? '' : 'error'}
        />
        <Input
          prefix="Label"
          value={label}
          maxLength={120}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
        <Space>
          Cap{' '}
          <InputNumber
            step={0.05}
            placeholder="inherit"
            value={cap === null ? null : cap / BASIS_POINTS}
            suffix="×"
            onChange={(v) => {
              setCap(v === null ? null : toBp(v));
            }}
          />
        </Space>
        {tiers === null ? (
          <Button
            onClick={() => {
              setTiers([...DEFAULT_SURGE_TIERS]);
            }}
          >
            Use a custom ladder
          </Button>
        ) : (
          <>
            <TierLadderEditor tiers={tiers} onChange={setTiers} />
            <Button
              size="small"
              onClick={() => {
                setTiers(null);
              }}
            >
              Inherit the global ladder instead
            </Button>
          </>
        )}
        <Input.TextArea
          rows={2}
          maxLength={500}
          showCount
          placeholder="Reason (audited, required)"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        {save.error ? <Alert type="error" showIcon message={errorText(save.error)} /> : null}
      </Space>
    </Modal>
  );
}
