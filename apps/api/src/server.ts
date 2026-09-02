import { buildApp } from './app.js';
import {
  PostgresMigrationError,
  runPostgresMigrations,
} from './postgres-migrations.js';

const host = process.env['HOST'] ?? '127.0.0.1';
const port = Number(process.env['PORT'] ?? 8080);

class StartupConfigurationError extends Error {
  override readonly name = 'StartupConfigurationError';
}

try {
  const databaseUrl = process.env['DATABASE_URL'];
  if (process.env['NODE_ENV'] === 'production' && !databaseUrl) {
    throw new StartupConfigurationError(
      'DATABASE_URL is required in production',
    );
  }
  if (
    process.env['NODE_ENV'] === 'production' &&
    !process.env['IPTVMASTER_MASTER_KEY']
  ) {
    throw new StartupConfigurationError(
      'IPTVMASTER_MASTER_KEY is required in production',
    );
  }
  const migrationResult = databaseUrl ? await runPostgresMigrations() : null;
  const app = await buildApp();
  if (migrationResult) {
    app.log.info(
      migrationResult,
      'PostgreSQL schema verified before application startup',
    );
  }
  await app.listen({ host, port });
} catch (error) {
  console.error(
    error instanceof PostgresMigrationError ||
      error instanceof StartupConfigurationError
      ? error.message
      : 'IPTVMaster failed to start',
  );
  process.exitCode = 1;
}
