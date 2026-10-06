import { dashboardSchema, type KpiQuery } from '@parkease/contracts/admin';
import { colors } from '@parkease/tokens';
import { Link } from '@tanstack/react-router';
import { Alert, Card, Col, DatePicker, Row, Space, Statistic, Switch, Typography } from 'antd';
import { useState } from 'react';

import { Money, PageState } from '../../components/data';
import { useApi, withQuery } from '../../lib/api';

import { lastDays, rangeQuery, type Range } from './range';

/** The SQL a card was computed from, so an operator who doubts a number can reproduce it in psql. */
const sqlFor = (q: KpiQuery): string =>
  q.side === 'net_credit'
    ? `SELECT sum(CASE direction WHEN 'credit' THEN amount_paise ELSE -amount_paise END) FROM ledger_entries WHERE account = '${q.account}' AND occurred_at >= '${q.from} 00:00+05:30' AND occurred_at < '${q.to} 00:00+05:30';`
    : `SELECT sum(amount_paise) FROM ledger_entries WHERE account = '${q.account}' AND direction = '${q.side}' AND occurred_at >= '${q.from} 00:00+05:30' AND occurred_at < '${q.to} 00:00+05:30';`;

export function DashboardPage() {
  const [range, setRange] = useState<Range>(lastDays(30));
  const [showQueries, setShowQueries] = useState(false);
  const dash = useApi(dashboardSchema, withQuery('/admin/dashboard', rangeQuery(range)));
  const d = dash.data?.data;

  const money: {
    title: string;
    paise: number;
    q: KpiQuery | undefined;
    note?: string | undefined;
  }[] = d
    ? [
        { title: 'Gross bookings', paise: d.grossPaise, q: d.queries.gross },
        {
          title: 'ParkEase Fee',
          paise: d.platformRevenuePaise,
          q: d.queries.platformRevenue,
          note:
            d.grossPaise > 0
              ? `${((d.platformRevenuePaise / d.grossPaise) * 100).toFixed(1)}% of gross`
              : undefined,
        },
        { title: 'Owner payable', paise: d.ownerPayablePaise, q: d.queries.ownerPayable },
        { title: 'GST payable', paise: d.gstPayablePaise, q: d.queries.gstPayable },
      ]
    : [];

  return (
    <>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Dashboard
        </Typography.Title>
        <Space wrap>
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(v) => {
              if (v?.[0] && v[1]) setRange([v[0], v[1]]);
            }}
          />
          <Space>
            <Switch checked={showQueries} onChange={setShowQueries} /> Show queries
          </Space>
        </Space>
      </Space>
      <PageState
        isLoading={dash.isLoading}
        error={dash.error}
        isEmpty={false}
        emptyText=""
        onRetry={() => void dash.refetch()}
      >
        {d ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {d.ledger.balanced ? null : (
              <Alert
                type="error"
                showIcon
                message="Ledger IMBALANCED — P0"
                description={
                  <>
                    Transactions whose debits ≠ credits:{' '}
                    {d.ledger.imbalancedTxnIds.map((t) => (
                      <Link key={t} to="/finance" search={{ txnId: t }} style={{ marginRight: 8 }}>
                        {t.slice(0, 8)}
                      </Link>
                    ))}
                  </>
                }
              />
            )}
            <Row gutter={[16, 16]}>
              {money.map((m) => (
                <Col key={m.title} xs={24} sm={12} lg={6}>
                  <Card size="small">
                    <Statistic title={m.title} valueRender={() => <Money paise={m.paise} />} />
                    {m.note ? <Typography.Text type="secondary">{m.note}</Typography.Text> : null}
                    {showQueries && m.q ? (
                      <Typography.Paragraph
                        code
                        copyable
                        style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}
                      >
                        {sqlFor(m.q)}
                      </Typography.Paragraph>
                    ) : null}
                  </Card>
                </Col>
              ))}
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic title="Bookings" value={d.bookings} />
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic title="Active spaces" value={d.activeSpaces} />
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small" title="Waiting for you">
                  <Space direction="vertical" size={2}>
                    <Link to="/spaces">Spaces: {d.pending.spaces}</Link>
                    <Link to="/partners">Partners: {d.pending.partners}</Link>
                    <Link to="/moderation">Reported reviews: {d.pending.reports}</Link>
                  </Space>
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic
                    title="Ledger"
                    value={d.ledger.balanced ? 'BALANCED' : 'IMBALANCED'}
                    valueStyle={{ color: d.ledger.balanced ? colors.available : colors.error }}
                  />
                </Card>
              </Col>
            </Row>
            <Typography.Text type="secondary">
              Every money figure above is one ledger query. Toggle “Show queries” to see which.
            </Typography.Text>
          </Space>
        ) : null}
      </PageState>
    </>
  );
}
