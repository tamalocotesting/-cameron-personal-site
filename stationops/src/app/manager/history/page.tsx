import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { query } from '@/lib/db';
import { filterToSearchParams, historyRows, parseHistoryFilter } from '@/lib/reports';
import { Card } from '@/components/ui';
import { RunTable } from '@/components/RunTable';

export const metadata = { title: 'History' };

const LIMIT = 500;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireManager();
  const filter = parseHistoryFilter(await searchParams);
  const [rows, people, stations] = await Promise.all([
    historyRows(user.restaurantId, filter, LIMIT),
    query<{ id: number; display_name: string; active: boolean }>(
      'select id, display_name, active from users where restaurant_id = $1 order by active desc, display_name',
      [user.restaurantId],
    ),
    query<{ id: number; name: string }>('select id, name from stations where restaurant_id = $1 order by name', [user.restaurantId]),
  ]);
  const qs = filterToSearchParams(filter);
  const field = 'block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History</h1>
          <p className="text-muted">Every checklist run, newest first. Dates are shift dates in the restaurant’s time zone.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/manager/history/export?${qs}`} className="rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white" download>
            Export CSV (summary)
          </a>
          <a href={`/manager/history/export?${qs}${qs ? '&' : ''}detail=1`} className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold" download>
            Export CSV (every task)
          </a>
        </div>
      </div>

      <Card className="p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Filter history">
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-semibold">From</label>
            <input id="from" name="from" type="date" defaultValue={filter.from} className={field} />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-semibold">To</label>
            <input id="to" name="to" type="date" defaultValue={filter.to} className={field} />
          </div>
          <div>
            <label htmlFor="employee" className="mb-1 block text-xs font-semibold">Employee</label>
            <select id="employee" name="employee" defaultValue={filter.employee ?? ''} className={field}>
              <option value="">Anyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                  {p.active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="station" className="mb-1 block text-xs font-semibold">Station</label>
            <select id="station" name="station" defaultValue={filter.station ?? ''} className={field}>
              <option value="">All stations</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="mb-1 block text-xs font-semibold">Status</label>
            <select id="status" name="status" defaultValue={filter.status ?? ''} className={field}>
              <option value="">Any status</option>
              <option value="complete">Complete</option>
              <option value="exceptions">Submitted with exceptions</option>
              <option value="in_progress">In progress / not submitted</option>
            </select>
          </div>
          <div>
            <label htmlFor="q" className="mb-1 block text-xs font-semibold">Search notes &amp; names</label>
            <input id="q" name="q" type="search" defaultValue={filter.q} placeholder="e.g. cooler" className={field} />
          </div>
          <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
            <button type="submit" className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white">
              Apply filters
            </button>
            <Link href="/manager/history" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">
              Clear
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        <p className="border-b border-line px-5 py-3 text-sm text-muted">
          {rows.length === LIMIT ? `Showing the newest ${LIMIT} runs. Narrow the dates to see older ones.` : `${rows.length} run${rows.length === 1 ? '' : 's'}`}
          {' · '}Days with no checklist at all do not appear here; the Pilot metric page accounts for them.
        </p>
        <RunTable rows={rows} timeZone={user.timezone} empty="No checklists match these filters." />
      </Card>
    </div>
  );
}
