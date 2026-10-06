import { useNavigate } from '@tanstack/react-router';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { initializeApp } from 'firebase/app';
import {
  type ConfirmationResult,
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'firebase/auth';
import { useRef, useState } from 'react';

import { FIXTURES } from '../../lib/api';
import { reportError } from '../../lib/report';
import { exchangeIdToken, fixtureSignIn } from '../../lib/session';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
};

const auth = FIXTURES ? null : getAuth(initializeApp(firebaseConfig));

/** Indian mobile, typed with or without +91 and spaces. */
const toE164 = (raw: string): string | null => {
  const digits = raw.replace(/\s+/g, '').replace(/^\+91/, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
};

export function LoginPage() {
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recaptcha = useRef<RecaptchaVerifier | null>(null);

  const finish = async (ok: boolean) => {
    if (ok) await navigate({ to: '/' });
    else setError('This number does not hold the admin role.');
  };

  const sendCode = async ({ phone }: { phone: string }) => {
    setError(null);
    if (FIXTURES) return finish((fixtureSignIn(), true));
    const e164 = toE164(phone);
    if (e164 === null || auth === null) {
      setError('Enter a 10-digit Indian mobile number.');
      return;
    }
    setBusy(true);
    try {
      recaptcha.current ??= new RecaptchaVerifier(auth, 'recaptcha', { size: 'invisible' });
      setConfirmation(await signInWithPhoneNumber(auth, e164, recaptcha.current));
    } catch (err: unknown) {
      reportError('OTP request failed', err);
      setError('Could not send the code. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async ({ code }: { code: string }) => {
    if (confirmation === null) return;
    setError(null);
    setBusy(true);
    try {
      const credential = await confirmation.confirm(code);
      await finish(await exchangeIdToken(await credential.user.getIdToken()));
    } catch (err: unknown) {
      reportError('OTP verification failed', err);
      setError('That code did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <Typography.Title level={4}>ParkEase Admin</Typography.Title>
        <Typography.Paragraph type="secondary">
          Every action here is recorded in the audit log.
        </Typography.Paragraph>
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        ) : null}
        {confirmation === null ? (
          <Form layout="vertical" onFinish={(v: { phone: string }) => void sendCode(v)}>
            <Form.Item label="Mobile number" name="phone" rules={[{ required: true }]}>
              <Input prefix="+91" inputMode="tel" autoComplete="tel-national" autoFocus />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              {FIXTURES ? 'Sign in (fixtures)' : 'Send code'}
            </Button>
          </Form>
        ) : (
          <Form layout="vertical" onFinish={(v: { code: string }) => void verify(v)}>
            <Form.Item label="6-digit code" name="code" rules={[{ required: true, len: 6 }]}>
              <Input inputMode="numeric" autoComplete="one-time-code" autoFocus />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              Verify
            </Button>
          </Form>
        )}
        <div id="recaptcha" />
      </Card>
    </div>
  );
}

export function NotAuthorisedPage() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <Alert
        type="warning"
        showIcon
        message="Not authorised"
        description="This account does not hold the admin role. Ask an existing admin to grant it."
      />
    </div>
  );
}
