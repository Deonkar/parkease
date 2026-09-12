export interface OtpConfirmation {
  confirm(code: string): Promise<{ idToken: string }>;
}

const DEV_MOCK_ENABLED = __DEV__;

export function requestOtp(e164Phone: string): Promise<OtpConfirmation> {
  if (DEV_MOCK_ENABLED) {
    return Promise.resolve({
      confirm(): Promise<{ idToken: string }> {
        return Promise.resolve({ idToken: `dev-mock-token-${e164Phone}` });
      },
    });
  }

  void e164Phone;
  throw new Error(
    'Firebase is not configured. Add @react-native-firebase/app and ' +
      '@react-native-firebase/auth, then replace this stub with the real implementation.',
  );
}

export async function confirmOtp(confirmation: OtpConfirmation, code: string): Promise<string> {
  const result = await confirmation.confirm(code);
  return result.idToken;
}
