// eslint-disable-next-line @typescript-eslint/no-require-imports
const firebaseAuth = require('@react-native-firebase/auth') as {
  default: () => {
    app: unknown;
    currentUser: { getIdToken: () => Promise<string> } | null;
    signInWithPhoneNumber: (
      phone: string,
    ) => Promise<{ confirm: (code: string) => Promise<unknown> }>;
  };
};

export interface OtpConfirmation {
  confirm(code: string): Promise<{ idToken: string }>;
}

function getAuth() {
  return firebaseAuth.default();
}

function isFirebaseAvailable(): boolean {
  try {
    return typeof firebaseAuth.default === 'function' && getAuth().app != null;
  } catch {
    return false;
  }
}

function createDevMock(e164Phone: string): OtpConfirmation {
  return {
    confirm(): Promise<{ idToken: string }> {
      return Promise.resolve({
        idToken: `dev-mock-token-${e164Phone}`,
      });
    },
  };
}

function wrapConfirmation(confirmation: {
  confirm: (code: string) => Promise<unknown>;
}): OtpConfirmation {
  return {
    async confirm(code: string): Promise<{ idToken: string }> {
      await confirmation.confirm(code);
      const user = getAuth().currentUser;
      if (!user) throw new Error('Authentication failed');
      const idToken = await user.getIdToken();
      return { idToken };
    },
  };
}

let pendingConfirmation: OtpConfirmation | null = null;

export async function requestOtp(e164Phone: string): Promise<void> {
  if (!isFirebaseAvailable()) {
    if (__DEV__) {
      pendingConfirmation = createDevMock(e164Phone);
      return;
    }
    throw new Error('Firebase is not configured. Run expo prebuild and rebuild the app.');
  }

  const confirmation = await getAuth().signInWithPhoneNumber(e164Phone);
  pendingConfirmation = wrapConfirmation(confirmation);
}

export async function confirmOtp(code: string): Promise<string> {
  if (!pendingConfirmation) {
    throw new Error('No pending OTP request. Call requestOtp first.');
  }
  const result = await pendingConfirmation.confirm(code);
  pendingConfirmation = null;
  return result.idToken;
}
