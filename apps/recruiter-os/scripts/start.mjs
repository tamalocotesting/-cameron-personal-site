#!/usr/bin/env node
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Runs the production build.
 *
 * `next start` does not serve a standalone build, and standalone is what the
 * container image runs — so this assembles the same tree the Dockerfile does
 * (static assets and public files next to server.js) and starts it. Running
 * the identical artefact locally is the point.
 */
const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.error('No standalone build found. Run `pnpm build` first.');
  process.exit(1);
}

cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), {
  recursive: true,
});
if (existsSync(path.join(root, 'public'))) {
  cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
}

const child = spawn(process.execPath, [path.join(standalone, 'server.js')], {
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT ?? '3000' },
  cwd: standalone,
});
child.on('exit', (code) => process.exit(code ?? 0));
