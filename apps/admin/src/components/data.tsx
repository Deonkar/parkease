import {
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  MinusCircleFilled,
} from '@ant-design/icons';
import { Alert, Button, Empty, Skeleton, Tag } from 'antd';
import type { ReactNode } from 'react';

import { ApiError } from '../lib/api';
import { formatInr } from '../lib/money';

export function Money({ paise, sign }: { paise: number; sign?: 'dr' | 'cr' | null }) {
  const text = formatInr(paise);
  return (
    <span
      style={{ fontVariantNumeric: 'tabular-nums' }}
      aria-label={sign ? `${text} ${sign}` : text}
    >
      {text}
      {sign ? <sup style={{ marginLeft: 2 }}>{sign === 'dr' ? 'Dr' : 'Cr'}</sup> : null}
    </span>
  );
}

type Tone = 'ok' | 'wait' | 'bad' | 'warn' | 'off';

const TONES: Record<Tone, { color: string; icon: ReactNode }> = {
  ok: { color: 'success', icon: <CheckCircleFilled /> },
  wait: { color: 'processing', icon: <ClockCircleFilled /> },
  bad: { color: 'error', icon: <CloseCircleFilled /> },
  warn: { color: 'warning', icon: <ExclamationCircleFilled /> },
  off: { color: 'default', icon: <MinusCircleFilled /> },
};

const TONE_OF: Record<string, Tone> = {
  active: 'ok',
  verified: 'ok',
  paid: 'ok',
  completed: 'ok',
  confirmed: 'ok',
  visible: 'ok',
  pending: 'wait',
  pending_approval: 'wait',
  pending_payment: 'wait',
  processing: 'wait',
  changes_requested: 'warn',
  unverified: 'warn',
  suspended: 'warn',
  no_show: 'warn',
  rejected: 'bad',
  blocked: 'bad',
  failed: 'bad',
  removed: 'bad',
  cancelled: 'off',
  expired: 'off',
  inactive: 'off',
  deleted: 'off',
};

/** Every status carries an icon and a word — never colour alone (prd.md §12). */
export function StatusBadge({ status }: { status: string }) {
  const tone = TONES[TONE_OF[status] ?? 'off'];
  return (
    <Tag color={tone.color} icon={tone.icon}>
      {status.replaceAll('_', ' ')}
    </Tag>
  );
}

/** Loading, error and empty in one place, so no page renders a blank table (rule 10). */
export function PageState({
  isLoading,
  error,
  isEmpty,
  emptyText,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyText: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (error !== null && error !== undefined) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    const trace = error instanceof ApiError && error.traceId ? ` (trace ${error.traceId})` : '';
    return (
      <Alert
        type="error"
        showIcon
        message="Could not load this page"
        description={`${message}${trace}`}
        action={<Button onClick={onRetry}>Retry</Button>}
      />
    );
  }
  if (isEmpty) return <Empty description={emptyText} />;
  return <>{children}</>;
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong.';
