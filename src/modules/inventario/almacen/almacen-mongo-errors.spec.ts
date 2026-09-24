import { isDuplicateKeyError } from './almacen-mongo-errors';

describe('isDuplicateKeyError (T2)', () => {
  it('returns true for a Mongo duplicate key error (code 11000)', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
  });

  it('returns false for a different error code', () => {
    expect(isDuplicateKeyError({ code: 121 })).toBe(false);
  });

  it('returns false for a plain Error without a code', () => {
    expect(isDuplicateKeyError(new Error('boom'))).toBe(false);
  });

  it('returns false for null/undefined/non-object values', () => {
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
    expect(isDuplicateKeyError('nope')).toBe(false);
  });
});
