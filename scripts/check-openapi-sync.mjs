import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const targetPath = path.resolve(process.cwd(), 'src/features/shared/api/schema.d.ts');
const tempPath = path.join(os.tmpdir(), `beam-openapi-${process.pid}.d.ts`);
const binPath = path.resolve(
  process.cwd(),
  'node_modules/.bin',
  process.platform === 'win32' ? 'openapi-typescript.cmd' : 'openapi-typescript'
);

try {
  execFileSync(binPath, ['docs/openapi.yaml', '-o', tempPath], {
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  if (!fs.existsSync(targetPath)) {
    console.error(`Missing generated OpenAPI types at ${targetPath}. Run npm run openapi:generate.`);
    process.exit(1);
  }

  const expected = fs.readFileSync(tempPath, 'utf8').replace(/\r\n/g, '\n');
  const actual = fs.readFileSync(targetPath, 'utf8').replace(/\r\n/g, '\n');

  if (expected !== actual) {
    console.error('OpenAPI generated types are out of sync with docs/openapi.yaml. Run npm run openapi:generate.');
    process.exit(1);
  }

  console.log('OpenAPI types are in sync with docs/openapi.yaml.');
} finally {
  if (fs.existsSync(tempPath)) {
    fs.unlinkSync(tempPath);
  }
}
