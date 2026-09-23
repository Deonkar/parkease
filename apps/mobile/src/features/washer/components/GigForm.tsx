import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CarwashServiceName } from '@parkease/contracts/enums';
import type { CreateWasherProfile, SubmitWasherDocuments } from '@parkease/contracts/washer';
import { colors, fontSize, lineHeight, spacing } from '@parkease/tokens';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HeldUploads } from '../hooks/useHeldUploads';
import {
  buildGigProfile,
  withoutError,
  type FieldErrors,
  type RegistrationField,
} from '../registration';

import { ServiceChecklist, SubmitBlock, TextField } from './FormFields';
import { PhotoField } from './PhotoField';

export interface GigSubmission {
  readonly profile: CreateWasherProfile;
  readonly documents: SubmitWasherDocuments;
}

export interface GigFormProps {
  /** ONE image — the side with the partner's photo (ruling T10-D1). */
  readonly idPhoto: HeldUploads;
  readonly onTakeIdPhoto: () => void;
  readonly submitting: boolean;
  readonly failure: string | null;
  readonly onSubmit: (submission: GigSubmission) => void;
}

/**
 * The individual registration of §14.2: name, one ID image, services.
 *
 * **There is no field for an identity number** (security.md §5.3). The name
 * is the only text input on this form; the ID is an image an admin looks at,
 * and the line under it says so. No profile photo in v1 (ruling T10-D2): there
 * is no endpoint that would store it as what it is.
 */
export function GigForm({ idPhoto, onTakeIdPhoto, submitting, failure, onSubmit }: GigFormProps) {
  const [name, setName] = useState('');
  const [services, setServices] = useState<readonly CarwashServiceName[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});

  const clear = (field: RegistrationField) => {
    setErrors((current) => withoutError(current, field));
  };

  const submit = () => {
    const built = buildGigProfile({
      name,
      idDocumentId: idPhoto.uploadIds[0] ?? null,
      services,
    });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    onSubmit({ profile: built.profile, documents: built.documents });
  };

  return (
    <View style={styles.form}>
      <TextField
        id="name"
        label="Your name"
        hint="The name you work under."
        value={name}
        onChangeText={(value) => {
          setName(value);
          clear('name');
        }}
        autoComplete="name"
        maxLength={120}
        error={errors.name}
      />

      <View style={styles.idBlock}>
        <PhotoField
          id="idDocument"
          label="ID proof"
          hint="One clear photo of the side with your photo on it."
          uploads={idPhoto}
          max={1}
          wide
          addLabel="Take photo"
          onAdd={() => {
            clear('idDocument');
            onTakeIdPhoto();
          }}
          error={errors.idDocument}
        />
        <View style={styles.reassure}>
          <MaterialCommunityIcons
            name="shield-check-outline"
            size={16}
            color={colors.primaryDark}
          />
          <Text style={styles.reassureText}>We verify your identity, not your number.</Text>
        </View>
      </View>

      <ServiceChecklist
        label="Services you can do"
        selected={services}
        onToggle={(service) => {
          setServices((current) =>
            current.includes(service)
              ? current.filter((s) => s !== service)
              : [...current, service],
          );
          clear('services');
        }}
        error={errors.services}
      />

      <SubmitBlock
        label="Submit for review"
        waitingForUploads={idPhoto.busy}
        submitting={submitting}
        failure={failure}
        onPress={submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.xl },
  idBlock: { gap: spacing.sm },
  reassure: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  reassureText: {
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: fontSize.xs * lineHeight.normal,
    color: colors.primaryDark,
  },
});
