import { prisma } from '@/server/db';

let tableNames: string[] | null = null;

/** Every application table, discovered once, so a new model cannot be missed. */
async function loadTableNames(): Promise<string[]> {
  if (tableNames) return tableNames;
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  tableNames = rows.map((r) => `"${r.tablename}"`);
  return tableNames;
}

export async function truncateAll() {
  const names = await loadTableNames();
  if (!names.length) return;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`);
}

export { prisma };
