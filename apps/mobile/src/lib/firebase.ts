export interface OtpConfirmation {
  confirm(code: string): Promise<{ idToken: string }>;
}

export function requestOtp(e164Phone: string): Promise<OtpConfirmation> {
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
