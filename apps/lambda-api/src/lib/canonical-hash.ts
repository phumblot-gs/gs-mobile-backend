import { createHash } from 'node:crypto';

/**
 * RFC 8785 (JSON Canonicalization Scheme, JCS) — minimal compliant
 * implementation suitable for the settings-blob payloads we accept:
 *
 *   - JSON objects: keys sorted lexicographically by UTF-16 code units
 *     (matching ECMAScript Array.prototype.sort()) at every depth.
 *   - JSON arrays: order preserved.
 *   - Strings: standard JSON escape sequences for control chars +
 *     `"` and `\\`; everything else passed through (UTF-8 already).
 *   - Numbers: shortest ECMAScript Number.prototype.toString() — JS
 *     handles this natively for finite doubles. NaN/Infinity rejected.
 *   - Booleans / null: `true`, `false`, `null`.
 *   - No whitespace anywhere.
 *
 * The reference fixtures used by both mobile clients live at
 * docs/canonical-hash-fixtures.json — if you change the algorithm,
 * regenerate the fixtures and bump the mobile-side test vectors.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot canonicalize non-finite number');
    }
    // ECMA-262 Number.prototype.toString() is the canonical short-form
    // representation matching RFC 8785's "JSON.stringify(x)" choice for
    // finite doubles.
    return String(value);
  }
  if (typeof value === 'string') return escapeString(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${escapeString(k)}:${canonicalize(v)}`)
      .join(',')}}`;
  }
  // bigint / function / symbol / undefined-at-top-level — not JSON-valid
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

function escapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 0x22: out += '\\"'; break;
      case 0x5c: out += '\\\\'; break;
      case 0x08: out += '\\b'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0d: out += '\\r'; break;
      case 0x09: out += '\\t'; break;
      default:
        if (c < 0x20) {
          out += `\\u${c.toString(16).padStart(4, '0')}`;
        } else {
          out += s[i];
        }
    }
  }
  return out + '"';
}

/** SHA-256 hex (lowercase) of the canonicalised JSON value. */
export function canonicalHash(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Byte length of the canonical JSON encoding (used for the 16 KB cap). */
export function canonicalByteLength(value: unknown): number {
  return Buffer.byteLength(canonicalize(value), 'utf8');
}
