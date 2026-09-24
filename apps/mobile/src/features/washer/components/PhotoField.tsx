import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAnnounce } from '@/features/shared/hooks/useAnnounce';

import type { HeldUpload, HeldUploads } from '../hooks/useHeldUploads';

import { FieldBlock } from './FormFields';

export interface PhotoFieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly uploads: HeldUploads;
  readonly max: number;
  /** Opens the camera; the capture comes back through `uploads.add`. */
  readonly onAdd: () => void;
  readonly addLabel: string;
  /** An ID card is landscape; shop photos are square. */
  readonly wide?: boolean;
  readonly error?: string | undefined;
}

const THUMB = spacing['3xl'] * 2;

/**
 * Photos in a form, each saying its state in words (R-FE-12): uploading,
 * uploaded, or the §6 failure copy with a Retry that sends the SAME photo — the
 * image stays on screen through a failure, so nobody re-shoots anything.
 */
export function PhotoField({
  id,
  label,
  hint,
  uploads,
  max,
  onAdd,
  addLabel,
  wide = false,
  error,
}: PhotoFieldProps) {
  const size = wide ? styles.wide : styles.square;
  const canAdd = uploads.items.length < max;

  return (
    <FieldBlock id={id} label={label} {...(hint === undefined ? {} : { hint })} error={error}>
      <View style={styles.grid} testID={`${id}-control`}>
        {uploads.items.map((item, index) => (
          <Tile
            key={item.key}
            item={item}
            position={index + 1}
            size={size}
            onRetry={() => void uploads.retry(item.key)}
            onRemove={() => {
              uploads.remove(item.key);
            }}
          />
        ))}

        {canAdd ? (
          <Pressable
            testID={`add-${id}`}
            accessibilityRole="button"
            accessibilityLabel={addLabel}
            onPress={onAdd}
            android_ripple={{ color: colors.surfaceTertiary }}
            style={[size, styles.add, error !== undefined && styles.addError]}
          >
            <MaterialCommunityIcons name="camera-plus-outline" size={28} color={colors.primary} />
            <Text style={styles.addLabel}>{addLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </FieldBlock>
  );
}

interface TileProps {
  readonly item: HeldUpload;
  readonly position: number;
  readonly size: StyleProp<ViewStyle>;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
}

function Tile({ item, position, size, onRetry, onRemove }: TileProps) {
  // H4: a photo that did not upload is said when it fails.
  useAnnounce(item.error);
  const state = item.uploading
    ? 'Uploading…'
    : item.error !== null
      ? item.error
      : item.uploadId !== null
        ? 'Uploaded'
        : 'Waiting to upload';

  return (
    <View style={styles.tile} testID={`upload-${item.key}`}>
      <View style={size}>
        <Image
          source={{ uri: item.uri }}
          style={[styles.image, item.error !== null && styles.imageFailed]}
          accessibilityLabel={`Photo ${String(position)}: ${state}`}
        />
        <Pressable
          testID={`remove-upload-${item.key}`}
          accessibilityRole="button"
          accessibilityLabel={`Remove photo ${String(position)}`}
          onPress={onRemove}
          hitSlop={spacing.sm}
          style={styles.remove}
        >
          <MaterialCommunityIcons name="close" size={16} color={colors.textInverse} />
        </Pressable>
      </View>

      <View style={styles.status}>
        <MaterialCommunityIcons
          name={
            item.uploading
              ? 'cloud-upload-outline'
              : item.error !== null
                ? 'alert-circle-outline'
                : 'check-circle-outline'
          }
          size={14}
          color={item.error !== null ? colors.errorInk : colors.textTertiary}
        />
        <Text style={[styles.statusText, item.error !== null && styles.statusFailed]}>{state}</Text>
      </View>

      {item.error === null ? null : (
        <Pressable
          testID={`retry-upload-${item.key}`}
          accessibilityRole="button"
          accessibilityLabel={`Retry uploading photo ${String(position)}`}
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  square: { width: THUMB, height: THUMB },
  wide: { width: THUMB * 1.5, height: THUMB },
  tile: { gap: spacing.xs, maxWidth: THUMB * 1.5 },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
  },
  imageFailed: { borderWidth: 2, borderColor: colors.error },
  remove: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    // 32dp plus an 8dp hit slop: the 48dp target on a thumbnail that cannot spare it.
    width: spacing['2xl'],
    height: spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  statusText: { flex: 1, fontSize: fontSize.xs, color: colors.textTertiary },
  statusFailed: { color: colors.errorInk },
  retry: { minHeight: 44, justifyContent: 'center' },
  retryLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  addError: { borderColor: colors.error },
  addLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
    textAlign: 'center',
  },
});
