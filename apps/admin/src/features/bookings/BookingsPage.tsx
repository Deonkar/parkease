import {
  adminBookingDetailSchema,
  adminBookingListItemSchema,
  adminRefundSchema,
  type AdminBookingDetail,
  type AdminBookingListItem,
  type AdminRefund,
  type LedgerEntry,
} from '@parkease/contracts/admin';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Table,
  Typography,
} from 'antd';
import { useState } from 'react';
import { z } from 'zod';

import { Money, PageState, StatusBadge, errorText } from '../../components/data';
import { intentKey, useAction, useApi, withQuery } from '../../lib/api';
import { formatInr, formatIst } from '../../lib/money';

const OPTION_LABEL = { full_minus_fee: 'Full minus ₹10 processing', half: '50%', custom: 'Custom' };

export function BookingsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useApi(
    z.array(adminBookingListItemSchema),
    withQuery('/admin/bookings', { q: search, page, pageSize: 20 }),
  );
  const total = Number(list.data?.meta?.total ?? 0);

  return (
    <>
      <Typography.Title level={3}>Bookings</Typography.Title>
      <Input.Search
        placeholder="Driver name or space"
        allowClear
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        style={{ width: 300, marginBottom: 16 }}
      />
      <PageState
        isLoading={list.isLoading}
        error={list.error}
        isEmpty={total === 0}
        emptyText="No bookings match."
        onRetry={() => void list.refetch()}
      >
        <Table<AdminBookingListItem>
          rowKey="id"
          dataSource={list.data?.data}
          scroll={{ x: 720 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: setPage,
            showSizeChanger: false,
          }}
          onRow={(row) => ({
            onClick: () => {
              setOpenId(row.id);
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            { title: 'Space', dataIndex: 'spaceTitle' },
            { title: 'Driver', dataIndex: 'driverName', render: (v: string | null) => v ?? '—' },
            { title: 'Starts', dataIndex: 'startsAt', render: formatIst },
            {
              title: 'Total',
              dataIndex: 'totalPaise',
              align: 'right',
              render: (p: number) => <Money paise={p} />,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: string) => <StatusBadge status={s} />,
            },
          ]}
        />
      </PageState>
      {openId === null ? null : (
        <BookingDetail
          id={openId}
          onClose={() => {
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}

function BookingDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useApi(adminBookingDetailSchema, `/admin/bookings/${id}`);
  const [dialog, setDialog] = useState<'refund' | 'cancel' | null>(null);
  const b = detail.data?.data;
  const debits =
    b?.ledger.filter((e) => e.direction === 'debit').reduce((s, e) => s + e.amountPaise, 0) ?? 0;
  const credits =
    b?.ledger.filter((e) => e.direction === 'credit').reduce((s, e) => s + e.amountPaise, 0) ?? 0;

  return (
    <Drawer
      open
      width="min(720px, 100vw)"
      title={`Booking ${id.slice(0, 8)}`}
      onClose={onClose}
      extra={
        b ? (
          <Space>
            <Button
              disabled={b.refundablePaise === 0}
              onClick={() => {
                setDialog('refund');
              }}
            >
              Refund…
            </Button>
            <Button
              danger
              disabled={!['confirmed', 'active'].includes(b.status)}
              onClick={() => {
                setDialog('cancel');
              }}
            >
              Cancel booking
            </Button>
          </Space>
        ) : null
      }
    >
      <PageState
        isLoading={detail.isLoading}
        error={detail.error}
        isEmpty={false}
        emptyText=""
        onRetry={() => void detail.refetch()}
      >
        {b ? (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Status">
                <StatusBadge status={b.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Driver">
                {b.driver.name ?? '—'} · {b.driver.phone}
              </Descriptions.Item>
              <Descriptions.Item label="Space">
                {b.space.title} · {b.space.ownerName ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Window">
                {formatIst(b.startsAt)} → {formatIst(b.endsAt)}
              </Descriptions.Item>
              <Descriptions.Item label="Driver paid">
                <Money paise={b.totalPaise} />
              </Descriptions.Item>
              <Descriptions.Item label="→ Owner">
                <Money paise={b.ownerEarningsPaise} />
              </Descriptions.Item>
              <Descriptions.Item label="→ ParkEase Fee">
                <Money paise={b.parkeaseFeePaise} />
              </Descriptions.Item>
              <Descriptions.Item label="→ GST">
                <Money paise={b.gstPaise} />
              </Descriptions.Item>
              <Descriptions.Item label="Refundable">
                <Money paise={b.refundablePaise} />
              </Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Title level={5}>Ledger trail</Typography.Title>
              <Typography.Paragraph type="secondary">
                The booking's actual entries. If they disagree with the figures above, the trail is
                right.
              </Typography.Paragraph>
              <Table<LedgerEntry>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={b.ledger}
                scroll={{ x: 560 }}
                columns={[
                  { title: 'Account', dataIndex: 'account' },
                  {
                    title: 'Dr',
                    align: 'right',
                    render: (_, e) =>
                      e.direction === 'debit' ? <Money paise={e.amountPaise} /> : null,
                  },
                  {
                    title: 'Cr',
                    align: 'right',
                    render: (_, e) =>
                      e.direction === 'credit' ? <Money paise={e.amountPaise} /> : null,
                  },
                  { title: 'Description', dataIndex: 'description' },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <b>
                        debits {formatInr(debits)} {debits === credits ? '=' : '≠'} credits{' '}
                        {formatInr(credits)}
                      </b>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </div>
          </Space>
        ) : null}
      </PageState>
      {b && dialog === 'refund' ? (
        <RefundDialog
          booking={b}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {b && dialog === 'cancel' ? (
        <CancelDialog
          id={b.id}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </Drawer>
  );
}

function RefundDialog({ booking, onClose }: { booking: AdminBookingDetail; onClose: () => void }) {
  const [option, setOption] = useState<AdminRefund['option']>(
    booking.refundOptions[0]?.option ?? 'custom',
  );
  const [customPaise, setCustomPaise] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [key] = useState(intentKey);
  const refund = useAction(z.unknown(), (body: AdminRefund) => ({
    path: `/admin/bookings/${booking.id}/refund`,
    body,
  }));
  // The contract validates the body here too, so the button is disabled for anything the API refuses.
  const candidate = adminRefundSchema.safeParse(
    option === 'custom' ? { option, amountPaise: customPaise, reason } : { option, reason },
  );
  const body: AdminRefund | null = candidate.success ? candidate.data : null;

  return (
    <Modal
      open
      title={`Refund — booking ${booking.id.slice(0, 8)}`}
      okText="Issue refund"
      okButtonProps={{ disabled: body === null }}
      confirmLoading={refund.isPending}
      onCancel={onClose}
      onOk={() => {
        if (body) refund.mutate({ vars: body, key }, { onSuccess: onClose });
      }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text>
          Refundable: <Money paise={booking.refundablePaise} /> ({booking.refundablePaise} paise)
        </Typography.Text>
        <Radio.Group
          value={option}
          onChange={(e) => {
            setOption(e.target.value as AdminRefund['option']);
          }}
        >
          <Space direction="vertical">
            {booking.refundOptions.map((o) => (
              <Radio key={o.option} value={o.option}>
                {OPTION_LABEL[o.option]} — <Money paise={o.amountPaise} />
              </Radio>
            ))}
            <Radio value="custom">
              Custom{' '}
              <InputNumber
                min={1}
                max={booking.refundablePaise}
                precision={0}
                suffix="paise"
                value={customPaise}
                onChange={setCustomPaise}
              />
            </Radio>
          </Space>
        </Radio.Group>
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
        <Alert
          type="info"
          showIcon
          message="Reversing ledger entries are written first. The Razorpay refund is sent by the worker afterwards — the money moves after the record."
        />
        {refund.error ? <Alert type="error" showIcon message={errorText(refund.error)} /> : null}
      </Space>
    </Modal>
  );
}

function CancelDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [key] = useState(intentKey);
  const cancel = useAction(z.unknown(), () => ({
    path: `/admin/bookings/${id}/cancel`,
    body: { reason },
  }));
  return (
    <Modal
      open
      title="Cancel this booking"
      okText="Cancel booking"
      okButtonProps={{ danger: true, disabled: reason.trim() === '' }}
      confirmLoading={cancel.isPending}
      onCancel={onClose}
      onOk={() => {
        cancel.mutate({ vars: undefined, key }, { onSuccess: onClose });
      }}
    >
      <Typography.Paragraph>
        The driver is refunded whatever the published cancellation tier says for an admin
        cancellation.
      </Typography.Paragraph>
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
      {cancel.error ? (
        <Alert type="error" showIcon message={errorText(cancel.error)} style={{ marginTop: 12 }} />
      ) : null}
    </Modal>
  );
}
