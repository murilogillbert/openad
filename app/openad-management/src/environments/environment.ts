const apiBaseUrl =
  (process.env['API_BASE_URL'] && process.env['API_BASE_URL'] !== ''
    ? process.env['API_BASE_URL']
    : undefined) ??
  (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true'
    ? 'http://127.0.0.1:3000/api/v1'
    : undefined);
if (apiBaseUrl == null || apiBaseUrl === '') {
  throw new Error(
    'API_BASE_URL is not set. Put it in repo root `.env` / `.env.dev` or run `pnpm management:serve` (dotenvx + @ngx-env/builder).'
  );
}

export const environment = {
  production: false,
  apiBaseUrl,
};
