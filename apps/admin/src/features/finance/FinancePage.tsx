import { DownloadOutlined } from '@ant-design/icons';
import {
  adminPayoutSchema,
  financeBalancesSchema,
  ledgerEntrySchema,
  reconciliationItemSchema,
  type AccountBalance,
  type AdminPayout,
  type LedgerEntry,
  type ReconciliationItem,
} from '@parkease/contracts/admin';
import { LEDGER_ACCOUNT_VALUES } from '@parkease/contracts/enums';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  DatePicker,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { z } from 'zod';

import { Money, PageState, StatusBadge, errorText } from '../../components/data';
import { FIXTURES, request, useApi, withQuery } from '../../lib/api';
import { formatIst } from '../../lib/money';
import { reportError } from '../../lib/report';
import { currentToken } from '../../lib/session';
import { lastDays, rangeQuery, type Range } from '../dashboard/range';

const ADR_021 = new Set(['tcs_payable', 'tds_payable']);

export function FinancePage({ txnId }: { txnId?: string | undefined }) {
  const [range, setRange] = useState<Range>(lastDays(30));
  return (
    <>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Finance
        </Typography.Title>
        <Space wrap>
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(v) => {
              if (v?.[0] && v[1]) setRange([v[0], v[1]]);
            }}
          />
          <ExportButton range={range} />
        </Space>
      </Space>
      <Tabs
        defaultActiveKey={txnId ? 'ledger' : 'balances'}
        items={[
          { key: 'balances', label: 'Account balances', children: <Balances range={range} /> },
          {
            key: 'ledger',
            label: 'Ledger explorer',
            children: <Explorer range={range} initialTxn={txnId} />,
          },
          { key: 'payouts', label: 'Payouts', children: <Payouts /> },
          {
            key: 'reconciliation',
            label: 'Reconciliation',
            children: <Reconciliation range={range} />,
          },
        ]}
      />
    </>
  );
}

function Balances({ range }: { range: Range }) {
  const q = useApi(financeBalancesSchema, withQuery('/admin/finance/balances', rangeQuery(range)));
  const b = q.data?.data;
  return (
    <PageState
      isLoading={q.isLoading}
      error={q.error}
      isEmpty={false}
      emptyText=""
      onRetry={() => void q.refetch()}
    >
      {b ? (
        <Table<AccountBalance>
          rowKey="account"
          dataSource={b.accounts}
          pagination={false}
          scroll={{ x: 640 }}
          columns={[
            {
              title: 'Account',
              dataIndex: 'account',
              render: (a: string) => (
                <>
                  {a}
                  {ADR_021.has(a) ? <Tag style={{ marginLeft: 8 }}>ADR-021</Tag> : null}
                </>
              ),
            },
            {
              title: 'Debits',
              dataIndex: 'debitsPaise',
              align: 'right',
              render: (p: number) => <Money paise={p} />,
            },
            {
              title: 'Credits',
              dataIndex: 'creditsPaise',
              align: 'right',
              render: (p: number) => <Money paise={p} />,
            },
            {
              title: 'Balance',
              align: 'right',
              render: (_, r) =>
                r.side === null ? '—' : <Money paise={r.balancePaise} sign={r.side} />,
            },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <b>TOTAL</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <b>
                  <Money paise={b.totalDebitsPaise} />
                </b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <b>
                  <Money paise={b.totalCreditsPaise} />
                </b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                {b.balanced ? (
                  <StatusBadge status="verified" />
                ) : (
                  <Tag color="error">IMBALANCED</Tag>
                )}
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      ) : null}
    </PageState>
  );
}

const cursorMeta = z.object({ nextCursor: z.string().nullable().optional() });

function Explorer({ range, initialTxn }: { range: Range; initialTxn?: string | undefined }) {
  const [account, setAccount] = useState<string>();
  const [txnId, setTxnId] = useState(initialTxn ?? '');
  const query = useInfiniteQuery({
    queryKey: ['ledger', account, txnId, ...range.map((d) => d.toISOString())],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(
        z.array(ledgerEntrySchema),
        withQuery('/admin/ledger', {
          account,
          txnId: txnId || undefined,
          ...rangeQuery(range),
          cursor: pageParam,
          limit: 100,
        }),
      ),
    getNextPageParam: (last) => cursorMeta.parse(last.meta ?? {}).nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="Account"
          style={{ width: 200 }}
          value={account}
          onChange={setAccount}
          options={LEDGER_ACCOUNT_VALUES.map((a) => ({ value: a, label: a }))}
        />
        <Input.Search
          placeholder="txn id"
          allowClear
          defaultValue={txnId}
          onSearch={setTxnId}
          style={{ width: 320 }}
        />
      </Space>
      <PageState
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={rows.length === 0}
        emptyText="No ledger entries in this range."
        onRetry={() => void query.refetch()}
      >
        <Table<LedgerEntry>
          rowKey="id"
          size="small"
          dataSource={rows}
          pagination={false}
          scroll={{ x: 860 }}
          columns={[
            { title: 'When', dataIndex: 'occurredAt', render: formatIst, width: 170 },
            {
              title: 'Txn',
              dataIndex: 'txnId',
              render: (t: string) => (
                <Typography.Text code copyable={{ text: t }}>
                  {t.slice(0, 8)}
                </Typography.Text>
              ),
            },
            { title: 'Account', dataIndex: 'account' },
            {
              title: 'Dr',
              align: 'right',
              render: (_, r) => (r.direction === 'debit' ? <Money paise={r.amountPaise} /> : null),
            },
            {
              title: 'Cr',
              align: 'right',
              render: (_, r) => (r.direction === 'credit' ? <Money paise={r.amountPaise} /> : null),
            },
            { title: 'Description', dataIndex: 'description' },
          ]}
        />
        {query.hasNextPage ? (
          <Button
            style={{ marginTop: 12 }}
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        ) : null}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          Append-only. A correction is a reversing entry made through the booking or payout it
          belongs to.
        </Typography.Paragraph>
      </PageState>
    </>
  );
}

function Payouts() {
  const q = useApi(z.array(adminPayoutSchema), withQuery('/admin/payouts', { pageSize: 50 }));
  return (
    <PageState
      isLoading={q.isLoading}
      error={q.error}
      isEmpty={(q.data?.data.length ?? 0) === 0}
      emptyText="No payouts yet."
      onRetry={() => void q.refetch()}
    >
      <Table<AdminPayout>
        rowKey="id"
        dataSource={q.data?.data}
        pagination={false}
        scroll={{ x: 720 }}
        columns={[
          { title: 'Period', dataIndex: 'period' },
          {
            title: 'Gross',
            dataIndex: 'grossPaise',
            align: 'right',
            render: (p: number) => <Money paise={p} />,
          },
          {
            title: 'Net',
            dataIndex: 'netPaise',
            align: 'right',
            render: (p: number) => <Money paise={p} />,
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (s: string) => <StatusBadge status={s} />,
          },
          {
            title: 'RazorpayX',
            dataIndex: 'razorpayPayoutId',
            render: (v: string | null) => v ?? '—',
          },
          { title: 'Failure', dataIndex: 'failureReason', render: (v: string | null) => v ?? '' },
        ]}
      />
    </PageState>
  );
}

function Reconciliation({ range }: { range: Range }) {
  const q = useApi(
    z.array(reconciliationItemSchema),
    withQuery('/admin/reconciliation', rangeQuery(range)),
  );
  return (
    <PageState
      isLoading={q.isLoading}
      error={q.error}
      isEmpty={(q.data?.data.length ?? 0) === 0}
      emptyText="Settlements match the ledger — nothing to reconcile."
      onRetry={() => void q.refetch()}
    >
      <Table<ReconciliationItem>
        rowKey="id"
        dataSource={q.data?.data}
        pagination={false}
        scroll={{ x: 720 }}
        columns={[
          { title: 'Found', dataIndex: 'createdAt', render: formatIst },
          {
            title: 'Kind',
            dataIndex: 'kind',
            render: (k: string) => <Tag color="error">{k.replaceAll('_', ' ')}</Tag>,
          },
          { title: 'Reference', dataIndex: 'reference' },
          {
            title: 'Expected',
            dataIndex: 'expectedPaise',
            align: 'right',
            render: (p: number | null) => (p === null ? '—' : <Money paise={p} />),
          },
          {
            title: 'Actual',
            dataIndex: 'actualPaise',
            align: 'right',
            render: (p: number | null) => (p === null ? '—' : <Money paise={p} />),
          },
          { title: 'Detail', dataIndex: 'detail' },
          {
            title: '',
            dataIndex: 'resolvedAt',
            render: (v: string | null) =>
              v ? <StatusBadge status="verified" /> : <StatusBadge status="pending" />,
          },
        ]}
      />
    </PageState>
  );
}

/** The export streams integer paise; the browser receives it with the bearer token and saves it. */
function ExportButton({ range }: { range: Range }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { from, to } = rangeQuery(range);
  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(
        withQuery(`${import.meta.env.VITE_API_URL ?? ''}/api/v1/admin/ledger/export`, { from, to }),
        {
          headers: { authorization: `Bearer ${currentToken() ?? ''}` },
        },
      );
      if (!res.ok) throw new Error(`Export failed with ${String(res.status)}`);
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `ledger-${from}-${to}.csv`,
      });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      reportError('ledger export failed', err);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Space>
      <Button
        icon={<DownloadOutlined />}
        loading={busy}
        disabled={FIXTURES}
        onClick={() => void download()}
      >
        Export CSV
      </Button>
      {error ? <Alert type="error" message={error} showIcon banner /> : null}
    </Space>
  );
}
