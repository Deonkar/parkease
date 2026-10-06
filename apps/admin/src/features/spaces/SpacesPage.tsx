import {
  adminSpaceDetailSchema,
  adminSpaceQueueItemSchema,
  type AdminSpaceQueueItem,
} from '@parkease/contracts/admin';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Image,
  Input,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { z } from 'zod';

import { Money, PageState, StatusBadge, errorText } from '../../components/data';
import { intentKey, useAction, useApi, withQuery } from '../../lib/api';
import { formatIst } from '../../lib/money';

type Decision = 'approve' | 'reject' | 'request-changes';

/** Each button says the status it produces — an operator should not need a manual. */
const DECISIONS: { decision: Decision; label: string; result: string; danger?: boolean }[] = [
  { decision: 'approve', label: 'Approve', result: '→ active' },
  { decision: 'request-changes', label: 'Request changes', result: '→ changes requested' },
  { decision: 'reject', label: 'Reject', result: '→ rejected (final)', danger: true },
];

export function SpacesPage() {
  const [status, setStatus] = useState('pending_approval');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useApi(
    z.array(adminSpaceQueueItemSchema),
    withQuery('/admin/spaces', { status, pageSize: 50 }),
  );

  return (
    <>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Approvals
        </Typography.Title>
        <Space.Compact>
          {['pending_approval', 'changes_requested', 'rejected', 'active'].map((s) => (
            <Button
              key={s}
              type={s === status ? 'primary' : 'default'}
              onClick={() => {
                setStatus(s);
              }}
            >
              {s.replaceAll('_', ' ')}
            </Button>
          ))}
        </Space.Compact>
      </Space>
      <PageState
        isLoading={list.isLoading}
        error={list.error}
        isEmpty={(list.data?.data.length ?? 0) === 0}
        emptyText="Nothing waiting in this queue."
        onRetry={() => void list.refetch()}
      >
        <Table<AdminSpaceQueueItem>
          rowKey="id"
          dataSource={list.data?.data}
          pagination={false}
          scroll={{ x: 720 }}
          onRow={(row) => ({
            onClick: () => {
              setOpenId(row.id);
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: 'Listing',
              render: (_, r) => (
                <>
                  <b>{r.title}</b>
                  <br />
                  <Typography.Text type="secondary">{r.address}</Typography.Text>
                </>
              ),
            },
            {
              title: 'Owner',
              render: (_, r) => (
                <>
                  {r.ownerName ?? '—'}
                  <br />
                  <Typography.Text type="secondary">{r.ownerPhone}</Typography.Text>
                </>
              ),
            },
            {
              title: 'First listing',
              dataIndex: 'isFirstListing',
              render: (v: boolean) => (v ? <Tag color="blue">first</Tag> : null),
            },
            { title: 'Submitted', dataIndex: 'submittedAt', render: formatIst },
            {
              title: 'Status',
              dataIndex: 'approvalStatus',
              render: (s: string) => <StatusBadge status={s} />,
            },
          ]}
        />
      </PageState>
      {openId === null ? null : (
        <SpaceReview
          id={openId}
          onClose={() => {
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}

function SpaceReview({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useApi(adminSpaceDetailSchema, `/admin/spaces/${id}`);
  const [notes, setNotes] = useState('');
  const decide = useAction(z.unknown(), ({ decision }: { decision: Decision }) => ({
    path: `/admin/spaces/${id}/${decision}`,
    body: decision === 'approve' ? {} : { notes },
  }));
  const s = detail.data?.data;

  return (
    <Drawer open width="min(640px, 100vw)" title={s?.title ?? 'Review listing'} onClose={onClose}>
      <PageState
        isLoading={detail.isLoading}
        error={detail.error}
        isEmpty={false}
        emptyText=""
        onRetry={() => void detail.refetch()}
      >
        {s ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {s.reviewNotes ? (
              <Alert
                type="warning"
                showIcon
                message="Earlier notes to the owner"
                description={s.reviewNotes}
              />
            ) : null}
            <Image.PreviewGroup>
              <Space wrap>
                {s.photos.map((url) => (
                  <Image
                    key={url}
                    src={url}
                    width={140}
                    height={100}
                    style={{ objectFit: 'cover' }}
                    alt="Listing photo"
                  />
                ))}
              </Space>
            </Image.PreviewGroup>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Owner">
                {s.ownerName ?? '—'} · {s.ownerPhone}
              </Descriptions.Item>
              <Descriptions.Item label="Listing">
                {s.isFirstListing ? 'first — approval required' : 'repeat owner'}
              </Descriptions.Item>
              <Descriptions.Item label="Address">{s.address}</Descriptions.Item>
              <Descriptions.Item label="Car">
                {s.pricing.car ? (
                  <>
                    <Money paise={s.pricing.car.hourlyPaise} />
                    /hr
                  </>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Two-wheeler">
                {s.pricing.twoWheeler ? (
                  <>
                    <Money paise={s.pricing.twoWheeler.hourlyPaise} />
                    /hr
                  </>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Amenities">
                {s.amenities.join(', ') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Location">
                <a
                  href={`https://www.openstreetmap.org/?mlat=${String(s.latitude)}&mlon=${String(s.longitude)}#map=18/${String(s.latitude)}/${String(s.longitude)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                </a>{' '}
                · zone {s.zoneId}
              </Descriptions.Item>
            </Descriptions>
            {s.approvalStatus === 'pending_approval' ? (
              <>
                <Input.TextArea
                  rows={3}
                  maxLength={1000}
                  showCount
                  placeholder="Notes to the owner — required to reject or request changes. Shown to them verbatim."
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                  }}
                />
                {decide.error ? (
                  <Alert type="error" showIcon message={errorText(decide.error)} />
                ) : null}
                <Space wrap>
                  {DECISIONS.map((d) => (
                    <Button
                      key={d.decision}
                      type={d.decision === 'approve' ? 'primary' : 'default'}
                      danger={d.danger === true}
                      disabled={d.decision !== 'approve' && notes.trim() === ''}
                      loading={decide.isPending && decide.variables.vars.decision === d.decision}
                      onClick={() => {
                        decide.mutate(
                          { vars: { decision: d.decision }, key: intentKey() },
                          { onSuccess: onClose },
                        );
                      }}
                    >
                      {d.label}{' '}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {d.result}
                      </Typography.Text>
                    </Button>
                  ))}
                </Space>
              </>
            ) : (
              <StatusBadge status={s.approvalStatus} />
            )}
          </Space>
        ) : null}
      </PageState>
    </Drawer>
  );
}
