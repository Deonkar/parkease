import {
  adminPartnerDetailSchema,
  adminPartnerSchema,
  type AdminPartner,
} from '@parkease/contracts/admin';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Image,
  Input,
  Space,
  Table,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { PageState, StatusBadge, errorText } from '../../components/data';
import { intentKey, useAction, useApi, withQuery } from '../../lib/api';
import { formatIst } from '../../lib/money';

const DOC_LABEL = {
  driving_licence: 'Driving licence',
  id_proof: 'ID proof',
  business_photo: 'Business photo',
};

export function PartnersPage() {
  const [status, setStatus] = useState('pending');
  const [open, setOpen] = useState<AdminPartner | null>(null);
  const list = useApi(
    z.array(adminPartnerSchema),
    withQuery('/admin/partners', { status, pageSize: 50 }),
  );

  return (
    <>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Partners
        </Typography.Title>
        <Space.Compact>
          {['pending', 'verified', 'rejected'].map((s) => (
            <Button
              key={s}
              type={s === status ? 'primary' : 'default'}
              onClick={() => {
                setStatus(s);
              }}
            >
              {s}
            </Button>
          ))}
        </Space.Compact>
      </Space>
      <PageState
        isLoading={list.isLoading}
        error={list.error}
        isEmpty={(list.data?.data.length ?? 0) === 0}
        emptyText="No partners in this state."
        onRetry={() => void list.refetch()}
      >
        <Table<AdminPartner>
          rowKey={(r) => `${r.kind}:${r.userId}`}
          dataSource={list.data?.data}
          pagination={false}
          scroll={{ x: 640 }}
          onRow={(row) => ({
            onClick: () => {
              setOpen(row);
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: 'Partner',
              render: (_, r) => (
                <>
                  <b>{r.displayName ?? r.name ?? '—'}</b>
                  <br />
                  <Typography.Text type="secondary">{r.phone}</Typography.Text>
                </>
              ),
            },
            { title: 'Kind', dataIndex: 'kind' },
            { title: 'Requested', dataIndex: 'requestedAt', render: formatIst },
            {
              title: 'Status',
              dataIndex: 'verificationStatus',
              render: (s: string) => <StatusBadge status={s} />,
            },
          ]}
        />
      </PageState>
      {open === null ? null : (
        <PartnerReview
          partner={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

/** Seconds until the earliest document link expires; the drawer refetches at zero (task 18 §18.9). */
function useExpiry(expiresAt: (string | null)[], onExpire: () => void): number | null {
  const first = expiresAt.filter((e): e is string => e !== null).sort()[0];
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (first === undefined) {
      setLeft(null);
      return;
    }
    const tick = () => {
      const s = Math.max(0, Math.round((Date.parse(first) - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) onExpire();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [first, onExpire]);
  return left;
}

function PartnerReview({ partner, onClose }: { partner: AdminPartner; onClose: () => void }) {
  const detail = useApi(
    adminPartnerDetailSchema,
    withQuery(`/admin/partners/${partner.userId}`, { kind: partner.kind }),
  );
  const [notes, setNotes] = useState('');
  const decide = useAction(z.unknown(), ({ verdict }: { verdict: 'verify' | 'reject' }) => ({
    path: `/admin/partners/${partner.userId}/${verdict}`,
    body: verdict === 'verify' ? { kind: partner.kind } : { kind: partner.kind, notes },
  }));
  const d = detail.data?.data;
  const left = useExpiry(
    d?.documents.map((doc) => doc.expiresAt) ?? [],
    () => void detail.refetch(),
  );

  return (
    <Drawer
      open
      width="min(640px, 100vw)"
      title={`${d?.displayName ?? partner.name ?? 'Partner'} · ${partner.kind}`}
      onClose={onClose}
    >
      <PageState
        isLoading={detail.isLoading}
        error={detail.error}
        isEmpty={false}
        emptyText=""
        onRetry={() => void detail.refetch()}
      >
        {d ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Name shown to drivers">
                {d.displayName ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Phone">{d.phone}</Descriptions.Item>
              {d.vehicleNumber ? (
                <Descriptions.Item label="Vehicle">{d.vehicleNumber}</Descriptions.Item>
              ) : null}
              <Descriptions.Item label="Status">
                <StatusBadge status={d.verificationStatus} />
              </Descriptions.Item>
            </Descriptions>
            <Card
              size="small"
              title="Documents"
              extra={
                left === null ? null : (
                  <Typography.Text type="secondary">
                    links expire in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                  </Typography.Text>
                )
              }
            >
              {d.documents.length === 0 ? (
                <Alert type="warning" showIcon message="No documents on file." />
              ) : (
                <Image.PreviewGroup>
                  <Space wrap>
                    {d.documents.map((doc) => (
                      <Space key={doc.url} direction="vertical" size={4}>
                        <Image
                          src={doc.url}
                          width={150}
                          height={110}
                          style={{ objectFit: 'cover' }}
                          alt={DOC_LABEL[doc.kind]}
                        />
                        <Typography.Text type="secondary">{DOC_LABEL[doc.kind]}</Typography.Text>
                      </Space>
                    ))}
                  </Space>
                </Image.PreviewGroup>
              )}
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                We never store the Aadhaar number. Confirm the document, not the digits.
              </Typography.Paragraph>
            </Card>
            {d.verificationStatus === 'pending' ? (
              <>
                <Input.TextArea
                  rows={3}
                  maxLength={1000}
                  showCount
                  placeholder="Notes (required to reject)"
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                  }}
                />
                {decide.error ? (
                  <Alert type="error" showIcon message={errorText(decide.error)} />
                ) : null}
                <Space>
                  <Button
                    type="primary"
                    loading={decide.isPending}
                    onClick={() => {
                      decide.mutate(
                        { vars: { verdict: 'verify' }, key: intentKey() },
                        { onSuccess: onClose },
                      );
                    }}
                  >
                    Verify → active
                  </Button>
                  <Button
                    danger
                    disabled={notes.trim() === ''}
                    loading={decide.isPending}
                    onClick={() => {
                      decide.mutate(
                        { vars: { verdict: 'reject' }, key: intentKey() },
                        { onSuccess: onClose },
                      );
                    }}
                  >
                    Reject
                  </Button>
                </Space>
              </>
            ) : null}
          </Space>
        ) : null}
      </PageState>
    </Drawer>
  );
}
