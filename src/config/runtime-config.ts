export type RuntimeEnvironment =
  'development' | 'test' | 'production' | 'maintenance';

export interface RuntimeConfig {
  PORT: number;
  NODE_ENV: RuntimeEnvironment;
  SWAGGER_ENABLED: boolean;
  CORS_ORIGINS: string[];
}

function requiredString(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function parseOrigins(
  value: unknown,
  environment: RuntimeEnvironment,
): string[] {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string') throw new Error('CORS_ORIGINS is invalid');

  const origins = value.split(',').map((origin) => origin.trim());
  if (origins.some((origin) => !origin)) {
    throw new Error('CORS_ORIGINS contains an empty origin');
  }

  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS contains an invalid origin');
    }
    const validProtocol =
      url.protocol === 'https:' ||
      (environment !== 'production' && url.protocol === 'http:');
    if (
      !validProtocol ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('CORS_ORIGINS must contain exact allowed origins');
    }
  }

  if (new Set(origins).size !== origins.length) {
    throw new Error('CORS_ORIGINS contains duplicate origins');
  }
  return origins;
}

export function parseRuntimeConfig(
  env: Record<string, unknown>,
): Record<string, unknown> & RuntimeConfig {
  const environment = requiredString(env, 'NODE_ENV');
  if (
    environment !== 'development' &&
    environment !== 'test' &&
    environment !== 'production' &&
    environment !== 'maintenance'
  ) {
    throw new Error('NODE_ENV is invalid');
  }

  const portInput = requiredString(env, 'PORT');
  const port = Number(portInput);
  if (
    !/^\d{1,5}$/.test(portInput) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const swaggerInput = env.SWAGGER_ENABLED;
  if (
    swaggerInput !== undefined &&
    swaggerInput !== 'true' &&
    swaggerInput !== 'false'
  ) {
    throw new Error('SWAGGER_ENABLED must be true or false');
  }

  return {
    ...env,
    PORT: port,
    NODE_ENV: environment,
    SWAGGER_ENABLED:
      swaggerInput === undefined
        ? environment !== 'production'
        : swaggerInput === 'true',
    CORS_ORIGINS: parseOrigins(env.CORS_ORIGINS, environment),
  };
}
