import { afterEach, beforeEach } from 'vitest';
import { truncateAll } from './db';
import { __resetClock } from '@/server/clock';
import { __resetRateLimits } from '@/server/rate-limit';

/**
 * A clean database and a clean clock before every test. Tests that care about
 * time pin it explicitly; nothing depends on the wall clock.
 */
beforeEach(async () => {
  await truncateAll();
  __resetClock();
  __resetRateLimits();
});

afterEach(() => {
  __resetClock();
  __resetRateLimits();
});
