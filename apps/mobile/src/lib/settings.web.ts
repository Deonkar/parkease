/**
 * The web build of settings.ts. react-native-web has no `Linking.openSettings`, and a page
 * cannot open the browser's settings, so it says where the permission lives instead (S-135).
 */
export function openAppSettings(): Promise<void> {
  window.alert(
    'Permissions for this site are in your browser: tap the icon left of the address, then allow location or camera.',
  );
  return Promise.resolve();
}
