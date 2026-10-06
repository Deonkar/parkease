import {
  BASIS_POINTS,
  surgeConfigSchema,
  surgeSnapshotSchema,
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
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { z } from 'zod';

import { PageState, errorText } from '../../components/data';
import { intentKey, useAction, useApi } from '../../lib/api';
import { formatIst } from '../../lib/money';

const x = (bp: number): string => `${(bp / BASIS_POINTS).toFixed(2)}×`;
const pct = (bp: number): string => `${(bp / 100).toFixed(0)}%`;

const configRecordSchema = surgeConfigSchema.and(z.object({ updatedAt: z.string() }));
const zoneSchema = z
  .object({
    zoneId: z.string(),
    label: z.string(),
    enabled: z.boolean(),
    maxMultiplierBp: z.number().int().nullable().optional(),
    tiers: z.array(z.unknown()).nullable().optional(),
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
  const editTier = (i: number, patch: Partial<SurgeTier>) => {
    if (config) edit({ tiers: config.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
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
            <Table<SurgeTier>
              rowKey="minOccupancyBp"
              size="small"
              pagination={false}
              dataSource={config.tiers}
              columns={[
                {
                  title: 'Occupancy above',
                  render: (_, t, i) => (
                    <InputNumber
                      min={0}
                      max={100}
                      value={t.minOccupancyBp / 100}
                      suffix="%"
                      onChange={(v) => {
                        editTier(i, { minOccupancyBp: Math.round((v ?? 0) * 100) });
                      }}
                      disabled={i === 0}
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
                      onChange={(v) => {
                        editTier(i, { multiplierBp: Math.round((v ?? 1) * BASIS_POINTS) });
                      }}
                      disabled={i === 0}
                    />
                  ),
                },
                {
                  title: 'Badge',
                  dataIndex: 'badge',
                  render: (b: string | null) => (b ? <Tag>{b.replaceAll('_', ' ')}</Tag> : '—'),
                },
              ]}
            />
            <Form layout="inline">
              <Form.Item label="Peak">
                <InputNumber
                  step={0.05}
                  value={config.peakHourModifierBp / BASIS_POINTS}
                  onChange={(v) => {
                    edit({ peakHourModifierBp: Math.round((v ?? 1) * BASIS_POINTS) });
                  }}
                />
              </Form.Item>
              <Form.Item label="Weekend">
                <InputNumber
                  step={0.05}
                  value={config.weekendModifierBp / BASIS_POINTS}
                  onChange={(v) => {
                    edit({ weekendModifierBp: Math.round((v ?? 1) * BASIS_POINTS) });
                  }}
                />
              </Form.Item>
              <Form.Item label="Event">
                <InputNumber
                  step={0.05}
                  value={config.eventModifierBp / BASIS_POINTS}
                  onChange={(v) => {
                    edit({ eventModifierBp: Math.round((v ?? 1) * BASIS_POINTS) });
                  }}
                />
              </Form.Item>
              <Form.Item label="Cap">
                <InputNumber
                  step={0.05}
                  value={config.maxMultiplierBp / BASIS_POINTS}
                  suffix="×"
                  onChange={(v) => {
                    edit({ maxMultiplierBp: Math.round((v ?? 1) * BASIS_POINTS) });
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
  const [adding, setAdding] = useState(false);
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
            setAdding(true);
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
          scroll={{ x: 640 }}
          columns={[
            {
              title: 'Zone',
              dataIndex: 'zoneId',
              render: (z: string) => <Typography.Text code>{z}</Typography.Text>,
            },
            { title: 'Label', dataIndex: 'label' },
            {
              title: 'Cap',
              render: (_, z) => (z.maxMultiplierBp ? x(z.maxMultiplierBp) : 'inherited'),
            },
            {
              title: 'Tiers',
              render: (_, z) => (z.tiers ? `custom (${String(z.tiers.length)})` : 'inherited'),
            },
            {
              title: 'Now',
              render: (_, z) => (
                <>
                  {x(z.live.multiplierBp)}{' '}
                  <Typography.Text type="secondary">
                    at {pct(z.live.occupancyBp)} occupied
                  </Typography.Text>
                </>
              ),
            },
            {
              title: 'Enabled',
              render: (_, z) => (
                <Switch
                  checked={z.enabled}
                  loading={toggle.isPending}
                  onChange={(enabled) => {
                    toggle.mutate({ vars: { zoneId: z.zoneId, enabled }, key: intentKey() });
                  }}
                />
              ),
            },
          ]}
        />
      </PageState>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        An override cap may exceed the global cap — that is the point of an override — but it must
        ship with a ladder containing that multiplier and a badge, or the save is rejected.
      </Typography.Paragraph>
      {adding ? (
        <AddZone
          onClose={() => {
            setAdding(false);
          }}
        />
      ) : null}
    </Card>
  );
}

function AddZone({ onClose }: { onClose: () => void }) {
  const [form] = Form.useForm<{ zoneId: string; label: string; reason: string }>();
  const [key] = useState(intentKey);
  const add = useAction(z.unknown(), (body: { zoneId: string; label: string; reason: string }) => ({
    path: '/admin/surge/zones',
    body,
  }));
  return (
    <Modal
      open
      title="Add zone override"
      okText="Add"
      confirmLoading={add.isPending}
      onCancel={onClose}
      onOk={() =>
        void form.validateFields().then((v) => {
          add.mutate({ vars: v, key }, { onSuccess: onClose });
        })
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="zoneId"
          label="Zone (geohash, 6 chars)"
          rules={[
            { required: true, pattern: /^[0-9b-hjkmnp-z]{6}$/, message: 'A 6-character geohash' },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="label" label="Label" rules={[{ required: true, max: 120 }]}>
          <Input />
        </Form.Item>
        <Form.Item name="reason" label="Reason (audited)" rules={[{ required: true, max: 500 }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
      <Typography.Text type="secondary">
        Starts by inheriting the global ladder and cap. Edit tiers and cap through the API until the
        ladder editor for overrides lands.
      </Typography.Text>
      {add.error ? (
        <Alert type="error" showIcon message={errorText(add.error)} style={{ marginTop: 12 }} />
      ) : null}
    </Modal>
  );
}
