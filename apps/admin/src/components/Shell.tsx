import {
  AuditOutlined,
  BankOutlined,
  CarOutlined,
  DashboardOutlined,
  FlagOutlined,
  IdcardOutlined,
  LogoutOutlined,
  RiseOutlined,
  ShopOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { colors } from '@parkease/tokens';
import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import { Button, Grid, Layout, Menu, Skeleton, Typography } from 'antd';

import { logout, useSession } from '../lib/session';

const NAV = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/spaces', icon: <ShopOutlined />, label: 'Approvals' },
  { key: '/partners', icon: <IdcardOutlined />, label: 'Partners' },
  { key: '/users', icon: <TeamOutlined />, label: 'Users' },
  { key: '/bookings', icon: <CarOutlined />, label: 'Bookings' },
  { key: '/finance', icon: <BankOutlined />, label: 'Finance' },
  { key: '/surge', icon: <RiseOutlined />, label: 'Surge' },
  { key: '/moderation', icon: <FlagOutlined />, label: 'Moderation' },
  { key: '/audit', icon: <AuditOutlined />, label: 'Audit log' },
];

/**
 * Renders the shell only for an admin session. The API is the authority — every request is
 * authorised again server-side — this only avoids drawing a shell the user cannot use.
 */
export function RequireAdmin() {
  const { status, user } = useSession();
  if (status === 'loading') return <Skeleton active style={{ padding: 32 }} />;
  if (status === 'signed_out' || user === null) return <Navigate to="/login" />;
  if (!user.roles.includes('admin')) return <Navigate to="/not-authorised" />;
  return <Shell />;
}

function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const screens = Grid.useBreakpoint();
  const selected = NAV.filter((n) => n.key !== '/' && path.startsWith(n.key)).at(0)?.key ?? '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        breakpoint="lg"
        collapsedWidth={screens.md ? 64 : 0}
        width={220}
        style={{ borderRight: `1px solid ${colors.border}` }}
      >
        <Typography.Title level={5} style={{ padding: '20px 20px 8px', margin: 0 }}>
          ParkEase <Typography.Text type="secondary">Admin</Typography.Text>
        </Typography.Title>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={NAV.map((n) => ({ ...n, label: <Link to={n.key}>{n.label}</Link> }))}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{ display: 'flex', justifyContent: 'flex-end', paddingInline: 16, height: 56 }}
        >
          <Button icon={<LogoutOutlined />} onClick={() => void logout()}>
            Sign out
          </Button>
        </Layout.Header>
        <Layout.Content style={{ padding: screens.md ? 24 : 16, maxWidth: 1280, width: '100%' }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
