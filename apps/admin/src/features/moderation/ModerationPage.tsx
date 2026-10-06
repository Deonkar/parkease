import { moderationQueueItemSchema, type ModerationQueueItem } from '@parkease/contracts/admin';
import { formatStars, type RatingBp } from '@parkease/contracts/primitives';
import { Alert, Button, Card, Input, Modal, Rate, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { z } from 'zod';

import { PageState, errorText } from '../../components/data';
import { intentKey, useAction, useApi } from '../../lib/api';
import { formatIst } from '../../lib/money';

const stars = (bp: number | null): string =>
  bp === null ? 'unrated' : `${formatStars(bp as RatingBp)}★`;

export function ModerationPage() {
  const queue = useApi(z.array(moderationQueueItemSchema), '/admin/moderation/reviews');
  const [removing, setRemoving] = useState<ModerationQueueItem | null>(null);
  const dismiss = useAction(z.unknown(), (id: string) => ({
    path: `/admin/moderation/reviews/${id}/dismiss`,
  }));
  const items = queue.data?.data ?? [];

  return (
    <>
      <Typography.Title level={3}>Reported reviews</Typography.Title>
      <Typography.Paragraph type="secondary">
        Reported reviews stay visible until you act. Hiding on report would let an owner remove any
        review below four stars.
      </Typography.Paragraph>
      {dismiss.error ? (
        <Alert
          type="error"
          showIcon
          message={errorText(dismiss.error)}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <PageState
        isLoading={queue.isLoading}
        error={queue.error}
        isEmpty={items.length === 0}
        emptyText="No reported reviews."
        onRetry={() => void queue.refetch()}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {items.map((r) => (
            <Card key={r.id} size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space wrap>
                  <Rate disabled value={r.rating} />
                  <Tag>{r.targetType}</Tag>
                  <Typography.Text type="secondary">{formatIst(r.createdAt)}</Typography.Text>
                </Space>
                {/* Rendered as text: React escapes it, so a stored <script> is shown, never run. */}
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  {r.comment ?? <i>No comment</i>}
                </Typography.Paragraph>
                <Typography.Text type="secondary">
                  Reports:{' '}
                  {r.reports
                    .map(
                      (p) =>
                        `${p.reason.replaceAll('_', ' ')}${p.detail ? ` — “${p.detail}”` : ''}`,
                    )
                    .join(' · ')}
                </Typography.Text>
                <Typography.Text>
                  Impact: {stars(r.impact.currentAvgBp)} → {stars(r.impact.avgBpIfRemoved)} if
                  removed ({r.impact.countIfRemoved} reviews left)
                </Typography.Text>
                <Space>
                  <Button
                    danger
                    onClick={() => {
                      setRemoving(r);
                    }}
                  >
                    Remove
                  </Button>
                  <Button
                    loading={dismiss.isPending && dismiss.variables.vars === r.id}
                    onClick={() => {
                      dismiss.mutate({ vars: r.id, key: intentKey() });
                    }}
                  >
                    Keep — dismiss reports
                  </Button>
                </Space>
              </Space>
            </Card>
          ))}
        </Space>
      </PageState>
      {removing === null ? null : (
        <RemoveDialog
          review={removing}
          onClose={() => {
            setRemoving(null);
          }}
        />
      )}
    </>
  );
}

function RemoveDialog({ review, onClose }: { review: ModerationQueueItem; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [key] = useState(intentKey);
  const remove = useAction(z.unknown(), () => ({
    path: `/admin/moderation/reviews/${review.id}/remove`,
    body: { reason },
  }));
  return (
    <Modal
      open
      title="Remove this review"
      okText="Remove"
      okButtonProps={{ danger: true, disabled: reason.trim() === '' }}
      confirmLoading={remove.isPending}
      onCancel={onClose}
      onOk={() => {
        remove.mutate({ vars: undefined, key }, { onSuccess: onClose });
      }}
    >
      <Input.TextArea
        rows={3}
        maxLength={500}
        showCount
        placeholder="Reason (audited, required)"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
      />
      {remove.error ? (
        <Alert type="error" showIcon message={errorText(remove.error)} style={{ marginTop: 12 }} />
      ) : null}
    </Modal>
  );
}
