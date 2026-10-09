import { existsSync } from 'node:fs';

/** Load .env.local / .env for CLI scripts (Next.js does this itself for the app). */
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
