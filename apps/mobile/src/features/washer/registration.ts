import type { CarwashServiceName } from '@parkease/contracts/enums';
import {
  createWasherProfileSchema,
  submitWasherDocumentsSchema,
  type CreateWasherProfile,
  type OperatingHours,
  type SubmitWasherDocuments,
  type WasherProfileView,
} from '@parkease/contracts/washer';
import type { z } from 'zod';

/**
 * The two registration forms of §14.2, as data.
 *
 * Every check goes through the contract's own schemas, so the form and the
 * server cannot disagree about what a GSTIN or an `HH:mm` time is. The rules
 * the contract leaves to the client are added here — a business shows at least
 * one photo, a gig partner gives a name and an ID image — and every failure is
 * keyed by the FIELD it concerns, so the form can put it under that field.
 *
 * Neither draft has a field for an identity number (security.md §5.3). The
 * builders copy named fields into the output rather than spreading a draft, so
 * nothing extra a caller leaves on one can reach the wire.
 */

export type RegistrationField = 'name' | 'gstin' | 'photos' | 'hours' | 'services' | 'idDocument';

export type FieldErrors = Partial<Record<RegistrationField, string>>;

/** A field's error answered by an edit; the others stay until the next submit. */
export function withoutError(errors: FieldErrors, field: RegistrationField): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== field));
}

export interface BusinessDraft {
  readonly businessName: string;
  readonly gstin: string;
  readonly photoIds: readonly string[];
  /** `HH:mm`. One range for the whole week (ruling T10-D3). */
  readonly opens: string;
  readonly closes: string;
  readonly services: readonly CarwashServiceName[];
}

export interface GigDraft {
  readonly name: string;
  /** The uploaded ID image, once it has an id — ONE side (ruling T10-D1). */
  readonly idDocumentId: string | null;
  readonly services: readonly CarwashServiceName[];
}

export type BusinessBuild =
  | { readonly ok: true; readonly profile: CreateWasherProfile }
  | { readonly ok: false; readonly errors: FieldErrors };

export type GigBuild =
  | {
      readonly ok: true;
      readonly profile: CreateWasherProfile;
      readonly documents: SubmitWasherDocuments;
    }
  | { readonly ok: false; readonly errors: FieldErrors };

/** Words a partner can act on, one per field; the contract's messages are for developers. */
const COPY = {
  businessName: 'Enter your business name.',
  gigName: 'Enter your name.',
  nameTooLong: 'Keep the name under 120 characters.',
  gstin: 'That is not a valid GSTIN. It has 15 characters, like 29AABCS1429B1Z3.',
  photos: 'Add at least one photo of your business.',
  hours: 'Choose an opening and a closing time.',
  hoursOrder: 'The closing time must be after the opening time.',
  services: 'Choose at least one service you offer.',
  idDocument: 'Add a photo of your ID, the side with your photo.',
} as const;

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Which form field a contract path belongs to. */
const FIELD_FOR_PATH: Readonly<Record<string, RegistrationField>> = {
  businessName: 'name',
  gstin: 'gstin',
  businessPhotoIds: 'photos',
  operatingHours: 'hours',
  capabilities: 'services',
  idDocumentId: 'idDocument',
};

function messageFor(field: RegistrationField, issue: z.ZodIssue, partner: 'business' | 'gig') {
  switch (field) {
    case 'name':
      return issue.code === 'too_big'
        ? COPY.nameTooLong
        : partner === 'business'
          ? COPY.businessName
          : COPY.gigName;
    case 'gstin':
      return COPY.gstin;
    case 'photos':
      return COPY.photos;
    case 'hours':
      return COPY.hours;
    case 'services':
      return COPY.services;
    case 'idDocument':
      return COPY.idDocument;
  }
}

/** The first issue per field wins: one message under a field, not a list. */
function collect(errors: FieldErrors, issues: readonly z.ZodIssue[], partner: 'business' | 'gig') {
  for (const issue of issues) {
    const head = issue.path[0];
    const field = typeof head === 'string' ? FIELD_FOR_PATH[head] : undefined;
    if (field === undefined || errors[field] !== undefined) continue;
    errors[field] = messageFor(field, issue, partner);
  }
}

/** Blank means "not given": an optional field typed and then cleared is absent, not `''`. */
const given = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export function buildBusinessProfile(draft: BusinessDraft): BusinessBuild {
  const businessName = given(draft.businessName);
  const gstin = given(draft.gstin)?.toUpperCase();
  const range = { open: draft.opens, close: draft.closes };

  const parsed = createWasherProfileSchema.safeParse({
    partnerType: 'business',
    ...(businessName === undefined ? {} : { businessName }),
    ...(gstin === undefined ? {} : { gstin }),
    businessPhotoIds: [...draft.photoIds],
    operatingHours: Object.fromEntries(DAYS.map((day) => [day, range])),
    capabilities: [...draft.services],
  });

  const errors: FieldErrors = {};
  if (!parsed.success) collect(errors, parsed.error.issues, 'business');
  // The contract's own rule, restated: its refinement does not run while
  // another field is failing, and every error should show on the first submit.
  if (businessName === undefined) errors.name ??= COPY.businessName;
  // The contract's photo rule (T10-C1) is a refinement too, so it is restated
  // for the same reason.
  if (draft.photoIds.length === 0) errors.photos ??= COPY.photos;
  // `HH:mm` compares chronologically as a string. Overnight hours are not a v1
  // case, and a range that closes before it opens is far likelier a slip.
  if (errors.hours === undefined && draft.closes <= draft.opens) errors.hours = COPY.hoursOrder;

  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, profile: parsed.data };
}

export function buildGigProfile(draft: GigDraft): GigBuild {
  const name = given(draft.name);

  const parsed = createWasherProfileSchema.safeParse({
    partnerType: 'gig',
    // The name a gig partner trades under, and what a driver sees on the
    // washer card (ruling T10-C2). Never an identity number.
    ...(name === undefined ? {} : { businessName: name }),
    businessPhotoIds: [],
    capabilities: [...draft.services],
  });
  const documents = submitWasherDocumentsSchema.safeParse({
    idDocumentId: draft.idDocumentId ?? undefined,
  });

  const errors: FieldErrors = {};
  if (!parsed.success) collect(errors, parsed.error.issues, 'gig');
  if (!documents.success) collect(errors, documents.error.issues, 'gig');
  // Required by the contract as well; restated so it shows beside the others.
  if (name === undefined) errors.name ??= COPY.gigName;

  if (!parsed.success || !documents.success || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, profile: parsed.data, documents: documents.data };
}

/** The half-hour steps the hours stepper moves through. */
const STEP_MINUTES = 30;
const LAST_STEP = 24 * 60 - STEP_MINUTES;

const toMinutes = (time: string): number => {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
};

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * One half hour earlier or later, stopping at the ends of the day. A stepper
 * instead of a typed time: there is no time-picker dependency, Android's number
 * pad has no colon, and a control that can only produce a valid time never
 * needs an error message.
 */
export function stepTime(time: string, direction: 1 | -1): string {
  const next = Math.min(LAST_STEP, Math.max(0, toMinutes(time) + direction * STEP_MINUTES));
  return `${pad(Math.floor(next / 60))}:${pad(next % 60)}`;
}

/** `20:30` → `8:30 PM`. Written out rather than `toLocaleTimeString`, whose output varies by ICU build. */
export function formatTime12(time: string): string {
  const total = toMinutes(time);
  const hours = Math.floor(total / 60);
  const suffix = hours < 12 ? 'AM' : 'PM';
  const clock = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(clock)}:${pad(total % 60)} ${suffix}`;
}

/** The stored hours in one line, without pretending a per-day map is one range. */
export function describeHours(hours: OperatingHours | null): string {
  if (hours === null) return 'Not set';
  const ranges = DAYS.map((day) => hours[day]);
  const first = ranges[0];
  if (ranges.every((range) => range === undefined)) return 'Not set';
  const same = ranges.every(
    (range) => range !== undefined && range.open === first?.open && range.close === first.close,
  );
  if (!same || first === undefined) return 'Varies by day';
  return `${formatTime12(first.open)} – ${formatTime12(first.close)}, every day`;
}

/** A list compared as a set: the server may echo it in another order. */
const asSet = (values: readonly string[] | undefined): string =>
  [...(values ?? [])].sort().join('|');

/** JSON with sorted keys, so two equal objects compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether the profile the server holds is the one this form sent (G6).
 *
 * `WASHER_PROFILE_EXISTS` after a retry means an earlier attempt landed. If the
 * partner changed the form in between, the server kept the FIRST version, and
 * calling that "registered" would hide the edit they just made.
 */
export function matchesStoredProfile(
  sent: CreateWasherProfile,
  stored: WasherProfileView,
): boolean {
  return (
    sent.partnerType === stored.partnerType &&
    sent.businessName.trim() === (stored.businessName ?? '').trim() &&
    (sent.gstin ?? null) === stored.gstin &&
    asSet(sent.businessPhotoIds) === asSet(stored.businessPhotoIds) &&
    canonical(sent.operatingHours ?? null) === canonical(stored.operatingHours) &&
    asSet(sent.capabilities) === asSet(stored.capabilities)
  );
}
