import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${String(value)}`);
}

/** Stable sort that never depends on the engine's sort stability. */
export function sortBy<T>(items: readonly T[], ...keys: Array<(item: T) => number | string>): T[] {
  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      for (const key of keys) {
        const ka = key(a.item);
        const kb = key(b.item);
        if (ka < kb) return -1;
        if (ka > kb) return 1;
      }
      return a.index - b.index;
    })
    .map((w) => w.item);
}

export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
