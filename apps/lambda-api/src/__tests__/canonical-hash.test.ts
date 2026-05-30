import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalize, canonicalHash, canonicalByteLength } from '../lib/canonical-hash.js';

interface Case {
  name: string;
  input?: unknown;
  v1_expected_push_blob?: unknown;
  canonical: string;
  sha256_hex: string;
}

const fixturesPath = resolve(
  // The test runs from the repo root via vitest's default cwd.
  process.cwd(),
  'docs/canonical-hash-fixtures.json'
);
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8')) as { cases: Case[] };

describe('canonical-hash fixtures', () => {
  for (const c of fixtures.cases) {
    const payload = c.input ?? c.v1_expected_push_blob;
    it(`${c.name}: canonical string matches`, () => {
      expect(canonicalize(payload)).toBe(c.canonical);
    });
    it(`${c.name}: sha256 matches`, () => {
      expect(canonicalHash(payload)).toBe(c.sha256_hex);
    });
  }
});

describe('canonical-hash edge cases', () => {
  it('rejects non-finite numbers', () => {
    expect(() => canonicalize(NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
  });

  it('drops undefined object properties', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('byte length is utf-8', () => {
    // 'é' is 2 bytes in UTF-8.
    expect(canonicalByteLength({ k: 'é' })).toBe(canonicalize({ k: 'é' }).length + 1);
  });
});
