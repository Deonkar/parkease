import { adminUserSchema, type AdminUser } from '@parkease/contracts/admin';
import { ROLE_VALUES } from '@parkease/contracts/enums';
import { Alert, Button, Input, Modal, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { z } from 'zod';

import { PageState, StatusBadge, errorText } from '../../components/data';
import { intentKey, useAction, useApi, withQuery } from '../../lib/api';
import { formatIst } from '../../lib/money';

const ROLE_NOTE: Record<string, string> = {
  valet: 'granted as pending — documents still required',
  washer: 'granted as pending — documents still required',
  admin: 'full data access, every action audited, no undo',
};

type Dialog =
  | { kind: 'grant' | 'block' | 'unblock'; user: AdminUser }
  | { kind: 'revoke'; user: AdminUser; role: string };

export function UsersPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string>();
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const list = useApi(
    z.array(adminUserSchema),
    withQuery('/admin/users', { q: search, role, page, pageSize: 20 }),
  );
  const total = Number(list.data?.meta?.total ?? 0);

  return (
    <>
      <Typography.Title level={3}>Users</Typography.Title>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Name, or the full phone number"
          allowClear
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          style={{ width: 300 }}
        />
        <Select
          allowClear
          placeholder="Role"
          style={{ width: 140 }}
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          options={ROLE_VALUES.map((r) => ({ value: r, label: r }))}
        />
      </Space>
      <PageState
        isLoading={list.isLoading}
        error={list.error}
        isEmpty={total === 0}
        emptyText="No users match."
        onRetry={() => void list.refetch()}
      >
        <Table<AdminUser>
          rowKey="id"
          dataSource={list.data?.data}
          scroll={{ x: 760 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (v: string | null) => v ?? '—' },
            { title: 'Phone', dataIndex: 'phone' },
            {
              title: 'Roles',
              render: (_, u) =>
                u.roles.map((r) => (
                  <Tag
                    key={r.role}
                    closable={r.status !== 'suspended'}
                    onClose={(e) => {
                      e.preventDefault();
                      setDialog({ kind: 'revoke', user: u, role: r.role });
                    }}
                  >
                    {r.role}
                    {r.status === 'active' ? '' : ` · ${r.status}`}
                  </Tag>
                )),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: string) => <StatusBadge status={s} />,
            },
            { title: 'Joined', dataIndex: 'createdAt', render: formatIst },
            {
              title: '',
              render: (_, u) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() => {
                      setDialog({ kind: 'grant', user: u });
                    }}
                  >
                    Grant role
                  </Button>
                  {u.status === 'blocked' ? (
                    <Button
                      size="small"
                      onClick={() => {
                        setDialog({ kind: 'unblock', user: u });
                      }}
                    >
                      Unblock
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      danger
                      onClick={() => {
                        setDialog({ kind: 'block', user: u });
                      }}
                    >
                      Block
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </PageState>
      {dialog === null ? null : (
        <UserDialog
          dialog={dialog}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
    </>
  );
}

/** One modal for the four role/status mutations: each needs a reason, which the audit row keeps. */
function UserDialog({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [role, setRole] = useState<string>();
  const [key] = useState(intentKey);
  const held = new Set(
    dialog.user.roles.filter((r) => r.status !== 'suspended').map((r) => r.role),
  );
  const id = dialog.user.id;

  const action = useAction(z.unknown(), () => {
    switch (dialog.kind) {
      case 'grant':
        return { path: `/admin/users/${id}/roles`, body: { role, reason } };
      case 'revoke':
        return { path: `/admin/users/${id}/roles/${dialog.role}/revoke`, body: { reason } };
      case 'block':
        return { path: `/admin/users/${id}/block`, body: { reason } };
      case 'unblock':
        return { path: `/admin/users/${id}/unblock`, body: { reason } };
    }
  });

  const title = {
    grant: `Grant a role — ${dialog.user.name ?? dialog.user.phone}`,
    revoke: `Revoke ${dialog.kind === 'revoke' ? dialog.role : ''} — ${dialog.user.name ?? dialog.user.phone}`,
    block: `Block ${dialog.user.name ?? dialog.user.phone}`,
    unblock: `Unblock ${dialog.user.name ?? dialog.user.phone}`,
  }[dialog.kind];

  return (
    <Modal
      open
      title={title}
      okText={dialog.kind === 'grant' ? 'Grant role' : title.split(' ')[0]}
      okButtonProps={{
        danger: dialog.kind === 'block' || dialog.kind === 'revoke',
        disabled: reason.trim() === '' || (dialog.kind === 'grant' && role === undefined),
      }}
      confirmLoading={action.isPending}
      onCancel={onClose}
      onOk={() => {
        action.mutate({ vars: undefined, key }, { onSuccess: onClose });
      }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {dialog.kind === 'grant' ? (
          <Radio.Group
            value={role}
            onChange={(e) => {
              setRole(e.target.value as string);
            }}
          >
            <Space direction="vertical">
              {ROLE_VALUES.map((r) => (
                <Radio key={r} value={r} disabled={held.has(r)}>
                  {r}{' '}
                  <Typography.Text type="secondary">
                    {held.has(r) ? 'already held' : (ROLE_NOTE[r] ?? '')}
                  </Typography.Text>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        ) : null}
        {dialog.kind === 'block' ? (
          <Alert
            type="warning"
            showIcon
            message="Signs them out of every device now. An access token already issued lasts up to 15 minutes."
          />
        ) : null}
        <Input.TextArea
          rows={3}
          maxLength={500}
          showCount
          placeholder="Reason (recorded in the audit log, required)"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        {action.error ? <Alert type="error" showIcon message={errorText(action.error)} /> : null}
      </Space>
    </Modal>
  );
}
