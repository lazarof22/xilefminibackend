import { Types } from 'mongoose';
import { idCanonico, mismoId, variantesHex, variantesId } from './factura-ids';

const HEX = '507f1f77bcf86cd7994390aa';

describe('variantesHex', () => {
  it('returns the lowercase and uppercase hex of an ObjectId or a hex string in any case', () => {
    const esperado = [HEX, HEX.toUpperCase()];
    expect(variantesHex(new Types.ObjectId(HEX))).toEqual(esperado);
    expect(variantesHex(HEX.toUpperCase())).toEqual(esperado);
  });
});

describe('variantesId', () => {
  it('returns the ObjectId plus its lowercase and uppercase hex strings', () => {
    expect(variantesId(HEX)).toEqual([
      new Types.ObjectId(HEX),
      HEX,
      HEX.toUpperCase(),
    ]);
  });

  it('accepts an ObjectId or an uppercase hex string and yields the same variants', () => {
    const esperado = variantesId(HEX);
    expect(variantesId(new Types.ObjectId(HEX))).toEqual(esperado);
    expect(variantesId(HEX.toUpperCase())).toEqual(esperado);
  });

  it('returns a real ObjectId instance as the first variant', () => {
    expect(variantesId(HEX)[0]).toBeInstanceOf(Types.ObjectId);
  });
});

describe('idCanonico', () => {
  it('maps an ObjectId and its hex string in any case to the lowercase hex', () => {
    expect(idCanonico(new Types.ObjectId(HEX))).toBe(HEX);
    expect(idCanonico(HEX.toUpperCase())).toBe(HEX);
  });

  it('returns null for an absent value', () => {
    expect(idCanonico(null)).toBeNull();
    expect(idCanonico(undefined)).toBeNull();
  });
});

describe('mismoId', () => {
  it('matches an ObjectId against its hex string in any case', () => {
    expect(mismoId(new Types.ObjectId(HEX), HEX.toUpperCase())).toBe(true);
    expect(mismoId(HEX, new Types.ObjectId(HEX))).toBe(true);
  });

  it('does not match different ids or an absent value', () => {
    expect(mismoId(HEX, new Types.ObjectId())).toBe(false);
    expect(mismoId(undefined, HEX)).toBe(false);
    expect(mismoId(null, null)).toBe(false);
  });
});
