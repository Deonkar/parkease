import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  byTestId,
  mount,
  nodes,
  text,
  type RenderedNode,
} from '../../shared/__tests__/render-native';
import { BusinessForm } from '../components/BusinessForm';
import { GigForm } from '../components/GigForm';
import type { HeldUploads } from '../hooks/useHeldUploads';
import { SERVICE_LABELS } from '../labels';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  Image: 'Image',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

const heldUploads = (overrides: Partial<HeldUploads> = {}): HeldUploads => ({
  items: [],
  uploadIds: [],
  busy: false,
  add: vi.fn(() => Promise.resolve()),
  retry: vi.fn(() => Promise.resolve()),
  remove: vi.fn(),
  ...overrides,
});

const UPLOADED_ID = heldUploads({
  items: [
    { key: '1', uri: 'file:///id.jpg', uploadId: 'documents/id-1', uploading: false, error: null },
  ],
  uploadIds: ['documents/id-1'],
});

const UPLOADED_PHOTO = heldUploads({
  items: [
    { key: '1', uri: 'file:///shop.jpg', uploadId: 'spaces/1', uploading: false, error: null },
  ],
  uploadIds: ['spaces/1'],
});

const inputs = (tree: RenderedNode | null) => nodes(tree).filter((n) => n.type === 'TextInput');

const press = (view: { tree: () => RenderedNode | null }, testID: string) => {
  const node = byTestId(view.tree(), testID);
  if (node === undefined) throw new Error(`no ${testID}`);
  act(() => {
    (node.props['onPress'] as () => void)();
  });
};

const type = (view: { tree: () => RenderedNode | null }, testID: string, value: string) => {
  const node = byTestId(view.tree(), testID);
  if (node === undefined) throw new Error(`no ${testID}`);
  act(() => {
    (node.props['onChangeText'] as (v: string) => void)(value);
  });
};

/**
 * An error sits BELOW the field it concerns: inside that field's block, after
 * the control. A summary at the top of a long form is a message about a field
 * the partner has scrolled away from.
 */
const expectErrorBelow = (tree: RenderedNode | null, field: string, pattern: RegExp) => {
  const block = byTestId(tree, `field-${field}`);
  expect(block, `field-${field}`).toBeDefined();
  const inBlock = nodes(block ?? null);
  const error = byTestId(block ?? null, `${field}-error`);
  expect(error, `${field}-error`).toBeDefined();
  expect(text(error ?? null)).toMatch(pattern);
  const control = byTestId(block ?? null, `${field}-control`);
  expect(control, `${field}-control`).toBeDefined();
  expect(inBlock.indexOf(control as RenderedNode)).toBeLessThan(
    inBlock.indexOf(error as RenderedNode),
  );
};

describe('the gig form', () => {
  const gig = (overrides: Partial<Parameters<typeof GigForm>[0]> = {}) =>
    mount(
      <GigForm
        idPhoto={heldUploads()}
        onTakeIdPhoto={vi.fn()}
        submitting={false}
        failure={null}
        onSubmit={vi.fn()}
        {...overrides}
      />,
    );

  /**
   * security.md §5.3. The Aadhaar number is never collected — only an image
   * an admin looks at. The one text input on this form is the partner's name.
   */
  it('has no input for an identity number', () => {
    const fields = inputs(gig().tree());

    expect(fields).toHaveLength(1);
    expect(fields[0]?.props['accessibilityLabel']).toBe('Your name');
    for (const field of fields) {
      expect(JSON.stringify(field.props)).not.toMatch(/aadhaar|id number|number-pad|numeric/i);
    }
  });

  it('says why there is no number field', () => {
    expect(text(gig().tree())).toContain('We verify your identity, not your number.');
  });

  // Ruling T10-D1: one ID image, the side with the partner's photo.
  it('asks for one ID image, the side with the photo', () => {
    const shown = text(gig().tree());

    expect(shown).toMatch(/side with your photo/i);
    expect(shown).not.toMatch(/back/i);
  });

  // Ruling T10-D2: no profile photo in v1.
  it('does not ask for a profile photo', () => {
    expect(text(gig().tree())).not.toMatch(/profile photo/i);
  });

  it('offers all five services as checkboxes', () => {
    const tree = gig().tree();
    const boxes = nodes(tree).filter((n) => n.props['accessibilityRole'] === 'checkbox');

    expect(boxes).toHaveLength(5);
    for (const label of Object.values(SERVICE_LABELS)) expect(text(tree)).toContain(label);
  });

  it('puts every error under its own field, and submits nothing', () => {
    const onSubmit = vi.fn();
    const view = gig({ onSubmit });

    press(view, 'submit-registration');

    expectErrorBelow(view.tree(), 'name', /name/i);
    expectErrorBelow(view.tree(), 'idDocument', /ID/);
    expectErrorBelow(view.tree(), 'services', /at least one/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the profile and the one ID image once the form is complete', () => {
    const onSubmit = vi.fn();
    const view = gig({ onSubmit, idPhoto: UPLOADED_ID });

    type(view, 'name-control', 'Raju M.');
    press(view, 'service-quick_wipe');
    press(view, 'submit-registration');

    expect(onSubmit).toHaveBeenCalledWith({
      profile: {
        partnerType: 'gig',
        businessName: 'Raju M.',
        businessPhotoIds: [],
        capabilities: ['quick_wipe'],
      },
      documents: { idDocumentId: 'documents/id-1' },
    });
  });

  it('holds its submit while the ID is uploading', () => {
    const onSubmit = vi.fn();
    const view = gig({
      onSubmit,
      idPhoto: heldUploads({
        busy: true,
        items: [{ key: '1', uri: 'file:///id.jpg', uploadId: null, uploading: true, error: null }],
      }),
    });

    const submit = byTestId(view.tree(), 'submit-registration');
    expect(submit?.props['accessibilityState']).toMatchObject({ disabled: true });
    press(view, 'submit-registration');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a failed upload with its copy and a retry, keeping the image', () => {
    const idPhoto = heldUploads({
      items: [
        {
          key: '1',
          uri: 'file:///id.jpg',
          uploadId: null,
          uploading: false,
          error: "Couldn't upload the photo. Check your connection.",
        },
      ],
    });
    const view = gig({ idPhoto });
    const tree = view.tree();

    expect(text(tree)).toContain("Couldn't upload the photo. Check your connection.");
    expect(nodes(tree).some((n) => n.type === 'Image' && n.props['source'] !== undefined)).toBe(
      true,
    );
    press(view, 'retry-upload-1');
    expect(idPhoto.retry).toHaveBeenCalledWith('1');
  });

  it('shows the server failure, near the submit it came from', () => {
    const view = gig({ failure: "Couldn't submit. Check your connection and try again." });

    expect(text(byTestId(view.tree(), 'submit-failure') ?? null)).toContain("Couldn't submit");
  });
});

describe('the business form', () => {
  const business = (overrides: Partial<Parameters<typeof BusinessForm>[0]> = {}) =>
    mount(
      <BusinessForm
        photos={heldUploads()}
        onTakePhoto={vi.fn()}
        submitting={false}
        failure={null}
        onSubmit={vi.fn()}
        {...overrides}
      />,
    );

  it('labels every input visibly, never by placeholder alone', () => {
    const tree = business().tree();
    const shown = text(tree);

    expect(shown).toContain('Business name');
    expect(shown).toContain('GSTIN (optional)');
    for (const field of inputs(tree)) {
      expect(field.props['accessibilityLabel']).toBeTruthy();
    }
  });

  it('requires a business name, under the name field', () => {
    const view = business({ photos: UPLOADED_PHOTO });

    press(view, 'service-premium_wash');
    press(view, 'submit-registration');

    expectErrorBelow(view.tree(), 'name', /business name/i);
  });

  it('names GSTIN in the error for one it cannot accept, under the GSTIN field', () => {
    const view = business({ photos: UPLOADED_PHOTO });

    type(view, 'name-control', 'SparkleWash');
    type(view, 'gstin-control', '29AABCS');
    press(view, 'service-premium_wash');
    press(view, 'submit-registration');

    expectErrorBelow(view.tree(), 'gstin', /GSTIN/);
    expect(byTestId(view.tree(), 'name-error')).toBeUndefined();
  });

  it('requires a photo and a service, each under its field', () => {
    const view = business();

    type(view, 'name-control', 'SparkleWash');
    press(view, 'submit-registration');

    expectErrorBelow(view.tree(), 'photos', /photo/i);
    expectErrorBelow(view.tree(), 'services', /at least one/i);
  });

  it('marks a ticked service as checked, in its accessibility state', () => {
    const view = business();

    press(view, 'service-full_detailing');

    expect(byTestId(view.tree(), 'service-full_detailing')?.props['accessibilityState']).toEqual({
      checked: true,
    });
    expect(byTestId(view.tree(), 'service-quick_wipe')?.props['accessibilityState']).toEqual({
      checked: false,
    });
  });

  it('submits one registration with the photos, the hours for every day, and the services', () => {
    const onSubmit = vi.fn();
    const view = business({ onSubmit, photos: UPLOADED_PHOTO });

    type(view, 'name-control', 'SparkleWash');
    press(view, 'service-premium_wash');
    press(view, 'submit-registration');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const profile = (onSubmit.mock.calls[0]?.[0] ?? {}) as {
      businessPhotoIds?: string[];
      operatingHours?: Record<string, unknown>;
      capabilities?: string[];
    };
    expect(profile.businessPhotoIds).toEqual(['spaces/1']);
    expect(Object.keys(profile.operatingHours ?? {})).toHaveLength(7);
    expect(profile.capabilities).toEqual(['premium_wash']);
  });

  it('moves the opening time in half hours from its stepper', () => {
    const view = business();
    const before = text(byTestId(view.tree(), 'field-hours') ?? null);

    press(view, 'opens-later');

    expect(text(byTestId(view.tree(), 'field-hours') ?? null)).not.toBe(before);
    expect(text(byTestId(view.tree(), 'field-hours') ?? null)).toContain('7:30 AM');
  });

  it('holds its submit while a photo is uploading', () => {
    const view = business({ photos: heldUploads({ busy: true }) });

    expect(byTestId(view.tree(), 'submit-registration')?.props['accessibilityState']).toMatchObject(
      { disabled: true },
    );
  });
});
