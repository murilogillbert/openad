import { mapUnknownException } from './map-unknown-exception';

describe('mapUnknownException', () => {
  it('maps Mongo duplicate key (E11000)', () => {
    const err = Object.assign(new Error('dup'), {
      name: 'MongoServerError',
      code: 11000,
      keyValue: { x: 1 },
    });
    const m = mapUnknownException(err);
    expect(m.status).toBe(409);
    expect(m.code).toBe('DUPLICATE_KEY');
  });

  it('maps Mongoose CastError', () => {
    const err = Object.assign(new Error('Cast to ObjectId failed'), {
      name: 'CastError',
    });
    const m = mapUnknownException(err);
    expect(m.status).toBe(400);
    expect(m.code).toBe('BAD_INPUT');
  });

  it('maps generic Error to 500', () => {
    const m = mapUnknownException(new Error('boom'));
    expect(m.status).toBe(500);
    expect(m.code).toBe('INTERNAL_ERROR');
  });
});
