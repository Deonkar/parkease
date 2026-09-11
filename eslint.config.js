import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const API = 'apps/api/src';
const MOBILE = 'apps/mobile/src';

/** The complete public surface. structure.md §3. */
const ROLES = ['driver', 'owner', 'valet', 'washer', 'admin', 'shared', 'public'];
/** Mobile mirrors the API roles minus the server-only ones. structure.md §5. */
const MOBILE_FEATURES = ['driver', 'owner', 'valet', 'washer'];

/** roles/{r} may not import roles/{other}. Sharing moves down, never sideways. */
const roleIsolationZones = ROLES.map((role) => ({
  target: `${API}/roles/${role}`,
  from: `${API}/roles`,
  except: [`./${role}`],
  message:
    `roles/${role} may not import a sibling role folder. ` +
    'Move the shared logic into domains/ (structure.md §9, rules.md R-ARCH-04).',
}));

/** features/{r} may import features/shared, never a sibling feature. */
const featureIsolationZones = MOBILE_FEATURES.map((role) => ({
  target: `${MOBILE}/features/${role}`,
  from: `${MOBILE}/features`,
  except: [`./${role}`, './shared'],
  message:
    `features/${role} may not import a sibling feature. ` +
    'Move the shared code into features/shared (rules.md R-FE-14).',
}));

/** Route groups obey the same rule as the features they render. */
const routeGroupZones = MOBILE_FEATURES.map((role) => ({
  target: `apps/mobile/app/(${role})`,
  from: `${MOBILE}/features`,
  except: [`./${role}`, './shared'],
  message: `app/(${role}) may only import features/${role} and features/shared.`,
}));

const layerZones = [
  {
    target: `${API}/domains`,
    from: `${API}/roles`,
    message: 'domains/ must not import roles/. Nothing imports roles/ (structure.md §9).',
  },
  {
    target: `${API}/platform`,
    from: [`${API}/roles`, `${API}/domains`],
    message:
      'platform/ must not import roles/ or domains/. If a platform file needs to ' +
      'mention "booking", it belongs in a domain (structure.md §9).',
  },
  {
    target: `${API}/roles`,
    from: 'packages/db/src',
    message:
      'roles/ must not import @parkease/db. Controllers authorise, shape, and ' +
      'delegate — data access belongs to the owning domain (rules.md R-ARCH-02, R-ARCH-05).',
  },
  {
    target: 'apps/worker/src',
    from: `${API}/roles`,
    message: 'apps/worker imports domains/ and platform/ only, never roles/ (structure.md §4).',
  },
  {
    target: 'packages/contracts/src',
    from: ['apps', 'packages/db/src', 'packages/testing/src', 'packages/ui-native/src'],
    message:
      'packages/contracts imports nothing internal. It is a leaf by design ' + '(structure.md §9).',
  },
  {
    target: `${MOBILE}/features`,
    from: 'apps/mobile/app',
    message: 'features/ must not import from app/. Routing depends on features, not the reverse.',
  },
];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: ROOT },
    },
    settings: {
      'import/resolver': {
        typescript: { project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'] },
      },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          basePath: ROOT,
          zones: [
            ...layerZones,
            ...roleIsolationZones,
            ...featureIsolationZones,
            ...routeGroupZones,
          ],
        },
      ],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [{ pattern: '@parkease/**', group: 'internal', position: 'before' }],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'no-console': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: [
      'eslint.config.js',
      'vitest.config.ts',
      'test/**/*.spec.ts',
      'packages/config/**/*.js',
      '**/vite.config.ts',
      '**/vitest.config.ts',
      '**/vitest.integration.config.ts',
      '**/test/**/*.spec.ts',
      '**/test/**/*.test.ts',
      '**/drizzle.config.ts',
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/test/**/*.test.ts', '**/test/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/babel.config.js', '**/metro.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/babel.config.js', '**/metro.config.js'],
    languageOptions: {
      globals: { module: 'readonly', require: 'readonly', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/node_modules/**',
      'test/fixtures/**',
      '**/next-env.d.ts',
    ],
  },
);
