import { auditEntrySchema, type AuditEntry } from '@parkease/contracts/admin';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Input, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { z } from 'zod';

import { PageState } from '../../components/data';
import { request, withQuery } from '../../lib/api';
import { formatIst } from '../../lib/money';

const pageMeta = z.object({
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean().optional(),
});

/** Only the keys that changed. Values arrive redacted by the API (phones masked, secrets dropped). */
function DiffView({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(
    (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]),
  );
  if (keys.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
  const show = (v: unknown) =>
    v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v);
  return (
    <Space direction="vertical" size={0}>
      {keys.map((k) => (
        <Typography.Text key={k} style={{ fontSize: 12 }}>
          <b>{k}</b>: {show(before?.[k])} → {show(after?.[k])}
        </Typography.Text>
      ))}
    </Space>
  );
}

export function AuditPage() {
  const [action, setAction] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['audit', action],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(
        z.array(auditEntrySchema),
        withQuery('/admin/audit', { action, cursor: pageParam, limit: 50 }),
      ),
    getNextPageParam: (last) => pageMeta.parse(last.meta ?? {}).nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <Typography.Title level={3}>Audit log</Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="Action, e.g. user.role.grant"
          allowClear
          onSearch={setAction}
          style={{ width: 300 }}
        />
      </Space>
      <PageState
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={rows.length === 0}
        emptyText="No audit entries."
        onRetry={() => void query.refetch()}
      >
        <Table<AuditEntry>
          rowKey="id"
          dataSource={rows}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            { title: 'When', dataIndex: 'occurredAt', render: formatIst, width: 170 },
            {
              title: 'Admin',
              render: (_, r) =>
                r.actorName ?? (r.actorUserId === null ? 'system' : r.actorUserId.slice(0, 8)),
            },
            { title: 'Action', dataIndex: 'action', render: (v: string) => <Tag>{v}</Tag> },
            {
              title: 'Target',
              render: (_, r) => `${r.targetType} · ${r.targetId?.slice(0, 8) ?? '—'}`,
            },
            { title: 'Change', render: (_, r) => <DiffView before={r.before} after={r.after} /> },
            { title: 'IP', dataIndex: 'ipAddress', width: 130 },
            {
              title: 'Trace',
              dataIndex: 'traceId',
              render: (v: string | null) =>
                v ? (
                  <Typography.Text copyable code>
                    {v.slice(0, 12)}
                  </Typography.Text>
                ) : (
                  '—'
                ),
            },
          ]}
        />
        {query.hasNextPage ? (
          <Button
            style={{ marginTop: 16 }}
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load older
          </Button>
        ) : null}
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          Append-only. Nobody can edit this log, including you — the database refuses it.
        </Typography.Paragraph>
      </PageState>
    </>
  );
}
