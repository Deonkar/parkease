import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

function extractEnvExampleKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

function extractSchemaKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const regex = /^\s+([A-Z_][A-Z0-9_]*):/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) keys.add(match[1]);
  }
  return keys;
}

describe('.env.example completeness', () => {
  it('contains every key from the env schema', () => {
    const envExample = readFileSync('.env.example', 'utf-8');
    const envSchema = readFileSync('apps/api/src/platform/config/env.schema.ts', 'utf-8');

    const exampleKeys = extractEnvExampleKeys(envExample);
    const schemaKeys = extractSchemaKeys(envSchema);

    const missingFromExample: string[] = [];
    for (const key of schemaKeys) {
      if (!exampleKeys.has(key)) {
        missingFromExample.push(key);
      }
    }

    expect(
      missingFromExample,
      `These env schema keys are missing from .env.example: ${missingFromExample.join(', ')}`,
    ).toHaveLength(0);
  });
});
