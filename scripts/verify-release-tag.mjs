import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(projectRoot, path), 'utf8'));

const rootPackage = readJson('package.json');
const packageLock = readJson('package-lock.json');
const workspacePaths = [
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/core/package.json',
];
const expectedVersion = rootPackage.version;
const expectedTag = `v${expectedVersion}`;
const requestedTag =
  process.argv[2] === '--current' ? expectedTag : process.argv[2];

if (!requestedTag) {
  console.error('Usage: node scripts/verify-release-tag.mjs vVERSION');
  process.exit(2);
}

const mismatches = [];
if (requestedTag !== expectedTag) {
  mismatches.push(
    `release tag ${requestedTag} does not match package version ${expectedTag}`,
  );
}
if (packageLock.version !== expectedVersion) {
  mismatches.push(
    `package-lock version ${packageLock.version} does not match ${expectedVersion}`,
  );
}
if (packageLock.packages?.['']?.version !== expectedVersion) {
  mismatches.push(
    `package-lock root package version does not match ${expectedVersion}`,
  );
}
for (const workspacePath of workspacePaths) {
  const workspacePackage = readJson(workspacePath);
  if (workspacePackage.version !== expectedVersion) {
    mismatches.push(
      `${workspacePackage.name} version ${workspacePackage.version} does not match ${expectedVersion}`,
    );
  }
  const lockWorkspace =
    packageLock.packages?.[workspacePath.replace(/\/package\.json$/, '')];
  if (lockWorkspace?.version !== expectedVersion) {
    mismatches.push(
      `package-lock entry for ${workspacePackage.name} does not match ${expectedVersion}`,
    );
  }
}

if (mismatches.length > 0) {
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exit(1);
}

console.log(`Release version verified: ${expectedTag}`);
