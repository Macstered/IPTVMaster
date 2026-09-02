import {
  PostgresMigrationError,
  runPostgresMigrations,
} from './postgres-migrations.js';

try {
  const result = await runPostgresMigrations({
    onMigration: (message) => console.log(message),
  });
  console.log(
    `PostgreSQL migrations verified: ${result.total}; applied: ${result.applied}`,
  );
} catch (error) {
  console.error(
    error instanceof PostgresMigrationError
      ? error.message
      : 'PostgreSQL migration failed unexpectedly',
  );
  process.exitCode = 1;
}
