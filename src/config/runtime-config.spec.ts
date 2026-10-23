import { parseRuntimeConfig } from './runtime-config.js';

describe('parseRuntimeConfig', () => {
  const valid = { NODE_ENV: 'development', PORT: '7000' };

  it('coerces the port and applies environment defaults', () => {
    expect(parseRuntimeConfig(valid)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 7000,
      SWAGGER_ENABLED: true,
      CORS_ORIGINS: [],
    });
    expect(
      parseRuntimeConfig({ ...valid, NODE_ENV: 'production' }).SWAGGER_ENABLED,
    ).toBe(false);
  });

  it.each([
    [{ ...valid, PORT: '0' }, 'PORT'],
    [{ ...valid, PORT: '7000.5' }, 'PORT'],
    [{ ...valid, NODE_ENV: 'other' }, 'NODE_ENV'],
    [{ ...valid, SWAGGER_ENABLED: 'yes' }, 'SWAGGER_ENABLED'],
    [{ ...valid, CORS_ORIGINS: '*' }, 'CORS_ORIGINS'],
    [{ ...valid, CORS_ORIGINS: 'https://example.com/path' }, 'CORS_ORIGINS'],
    [
      { ...valid, NODE_ENV: 'production', CORS_ORIGINS: 'http://example.com' },
      'CORS_ORIGINS',
    ],
  ])('rejects malformed configuration without echoing values', (input, key) => {
    expect(() => parseRuntimeConfig(input)).toThrow(key);
    try {
      parseRuntimeConfig(input);
    } catch (error) {
      expect(String(error)).not.toContain('example.com');
    }
  });

  it('accepts unique exact origins', () => {
    expect(
      parseRuntimeConfig({
        ...valid,
        CORS_ORIGINS: 'http://localhost:3000,https://example.com',
      }).CORS_ORIGINS,
    ).toEqual(['http://localhost:3000', 'https://example.com']);
  });
});
