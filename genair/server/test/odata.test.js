import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, buildSearchFilter, escapeODataString, parsePaging, searchVariants } from '../src/priority.js';

test('escapeODataString doubles single quotes', () => {
  assert.equal(escapeODataString("O'Brien"), "O''Brien");
  assert.equal(escapeODataString("''"), "''''");
  assert.equal(escapeODataString('שלום'), 'שלום');
  assert.equal(escapeODataString(123), '123');
});

test('searchVariants covers casing and phone digits, deduplicated', () => {
  assert.deepEqual(searchVariants('denver'), ['denver', 'DENVER', 'Denver']);
  assert.deepEqual(searchVariants('כהן'), ['כהן']);
  assert.deepEqual(searchVariants('054-625'), ['054-625', '054625']);
  assert.deepEqual(searchVariants('  '), []);
});

test('buildSearchFilter ORs contains() over fields and escapes input', () => {
  assert.equal(buildSearchFilter(['CUSTDES', 'PHONE'], ''), '');
  assert.equal(
    buildSearchFilter(['CUSTDES', 'PHONE'], 'כהן'),
    "contains(CUSTDES,'כהן') or contains(PHONE,'כהן')",
  );
  const f = buildSearchFilter(['CUSTDES'], "o'b");
  assert.equal(f, "contains(CUSTDES,'o''b') or contains(CUSTDES,'O''B') or contains(CUSTDES,'O''b')");
  // An injection attempt stays inside the literal.
  const evil = buildSearchFilter(['CUSTDES'], "x') or (1 eq 1");
  assert.ok(evil.startsWith("contains(CUSTDES,'x'') or (1 eq 1')"));
});

test('buildQuery keeps $ keys literal, encodes values, drops empty', () => {
  const q = buildQuery({ $select: 'A,B', $filter: "contains(A,'ש ב')", $top: 5, $skip: 0, $orderby: '' });
  assert.equal(q, `$select=A%2CB&$filter=${encodeURIComponent("contains(A,'ש ב')")}&$top=5&$skip=0`);
});

test('parsePaging validates top/skip', () => {
  const p = (qs) => parsePaging(new URLSearchParams(qs));
  assert.deepEqual(p(''), { top: 50, skip: 0 });
  assert.deepEqual(p('top=3&skip=10'), { top: 3, skip: 10 });
  assert.throws(() => p('top=0'), { code: 'validation_error' });
  assert.throws(() => p('top=1000'), { code: 'validation_error' });
  assert.throws(() => p('skip=-1'), { code: 'validation_error' });
  assert.throws(() => p('top=abc'), { code: 'validation_error' });
});
