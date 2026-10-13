import { DEMO_TOKEN_PREFIX } from '@parkease/contracts/public';
import { initializeApp } from 'firebase/app';
import {
  type ConfirmationResult,
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'firebase/auth';

// The web build of firebase.ts. @react-native-firebase has no web target, so the web demo
// signs in with the Firebase JS SDK and an invisible reCAPTCHA, as apps/admin does.
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
};

const auth = config.apiKey === '' ? null : getAuth(initializeApp(config));

// The public web demo: no SMS; the API accepts `demo:<phone>` for its fixed demo accounts only.
const DEMO = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';

let recaptcha: RecaptchaVerifier | null = null;
let pending: ConfirmationResult | null = null;
let devPhone: string | null = null;
let demoPhone: string | null = null;

export async function requestOtp(e164Phone: string): Promise<void> {
  if (DEMO) {
    demoPhone = e164Phone;
    return;
  }
  if (auth === null) {
    // Same contract as native: the dev mock exists only in development.
    if (__DEV__) {
      devPhone = e164Phone;
      return;
    }
    throw new Error('Firebase is not configured. Set EXPO_PUBLIC_FIREBASE_* and rebuild.');
  }
  if (recaptcha === null) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    recaptcha = new RecaptchaVerifier(auth, host, { size: 'invisible' });
  }
  pending = await signInWithPhoneNumber(auth, e164Phone, recaptcha);
}

export async function confirmOtp(code: string): Promise<string> {
  if (demoPhone !== null) return `${DEMO_TOKEN_PREFIX}${demoPhone}`;
  if (devPhone !== null) {
    const token = `dev-mock-token-${devPhone}`;
    devPhone = null;
    return token;
  }
  if (pending === null) throw new Error('No pending OTP request. Call requestOtp first.');
  const { user } = await pending.confirm(code);
  pending = null;
  return user.getIdToken();
}
