import { describe, expect, it } from 'vitest';
import { header, isUuid, userIdFromHeader } from './headers';

describe('header', () => {
  it('returns null for missing header', () => {
    expect(header({ headers: {} }, 'x-api-key')).toBeNull();
  });

  it('trims string header values', () => {
    expect(header({ headers: { 'x-api-key': '  abc123  ' } }, 'x-api-key')).toBe('abc123');
  });

  it('returns first non-empty value for string[] headers', () => {
    expect(header({ headers: { 'x-api-key': ['', '  ', ' good '] } }, 'x-api-key')).toBe('good');
  });
});

describe('isUuid', () => {
  it('accepts valid UUIDs', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000001')).toBe(true);
  });

  it('rejects invalid UUIDs', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('userIdFromHeader', () => {
  it('returns 401 when header is missing', () => {
    expect(userIdFromHeader({ headers: {} })).toEqual({
      status: 401,
      error: 'User ID required',
    });
  });

  it('returns 400 when header is not a UUID', () => {
    expect(userIdFromHeader({ headers: { 'x-user-id': 'bad' } })).toEqual({
      status: 400,
      error: 'Invalid user_id (must be UUID)',
    });
  });

  it('returns normalized user id on success', () => {
    expect(userIdFromHeader({ headers: { 'x-user-id': ' 00000000-0000-0000-0000-0000000000aa ' } })).toEqual({
      userId: '00000000-0000-0000-0000-0000000000aa',
    });
  });
});
