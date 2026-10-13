import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, lineHeight, spacing } from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import * as Location from 'expo-location';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TextField } from '@/features/shared/components/FormFields';

import type { MeetingPoint } from '../api/addons';
import { checkMeetingPoint, MAX_ADDRESS_LENGTH, type MeetingPointDraft } from '../meeting-point';

import { PlaceSearchBar } from './PlaceSearchBar';

interface MeetingPointFormProps {
  readonly addressLabel: string;
  readonly submitLabel: string;
  readonly submitTestID: string;
  readonly submitting: boolean;
  readonly onSubmit: (point: MeetingPoint) => void;
}

/**
 * Where to meet: a location (the device's, or a searched place) plus the words
 * that find the driver at it. Used for the valet pickup and the return drop.
 */
export function MeetingPointForm({
  addressLabel,
  submitLabel,
  submitTestID,
  submitting,
  onSubmit,
}: MeetingPointFormProps) {
  const [point, setPoint] = useState<MeetingPointDraft['point']>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locateMe = async () => {
    setLocating(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) {
        setError('Location is off for ParkEase. Search for a place instead.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
      setPlaceLabel('Your current location');
    } catch (cause) {
      // Said on screen, never swallowed into a form that silently will not send (R-FAIL-01).
      setError(
        cause instanceof Error
          ? `We couldn't get your location: ${cause.message}`
          : "We couldn't get your location. Search for a place instead.",
      );
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={styles.form}>
      <PlaceSearchBar
        selectedLabel={placeLabel}
        placeholder="Search for a place"
        onSelect={(place) => {
          setPoint({ lat: place.lat, lng: place.lng });
          setPlaceLabel(place.title);
          // The place's full name is a good start; the driver can add the gate.
          if (address.trim().length === 0) setAddress(place.subtitle.slice(0, MAX_ADDRESS_LENGTH));
        }}
        onClear={() => {
          setPoint(null);
          setPlaceLabel(null);
        }}
      />
      <Button
        label={locating ? 'Finding you…' : 'Use my current location'}
        testID="meeting-use-location"
        variant="secondary"
        loading={locating}
        onPress={() => {
          void locateMe();
        }}
      />
      {point === null ? null : (
        <View style={styles.pinned} accessibilityLiveRegion="polite">
          <MaterialCommunityIcons name="map-marker-check" size={16} color={colors.availableInk} />
          <Text style={styles.pinnedText}>Location set: {placeLabel ?? 'pinned'}</Text>
        </View>
      )}
      <TextField
        id="meeting-address"
        label={addressLabel}
        hint="A gate, a building, a landmark — what the valet looks for."
        value={address}
        onChangeText={setAddress}
        autoCapitalize="sentences"
        maxLength={MAX_ADDRESS_LENGTH}
      />
      {error === null ? null : (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      <Button
        label={submitLabel}
        testID={submitTestID}
        loading={submitting}
        onPress={() => {
          const check = checkMeetingPoint({ point, address });
          if (!check.ok) {
            setError(check.error);
            return;
          }
          setError(null);
          onSubmit(check.value);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  pinned: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pinnedText: { fontSize: fontSize.sm, color: colors.availableInk },
  error: {
    fontSize: fontSize.sm,
    color: colors.errorInk,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
});
