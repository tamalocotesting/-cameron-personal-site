import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { query } from '@/lib/db';
import { listTemplates } from '@/lib/templates';
import { formatDateTime } from '@/lib/time';
import { Card } from '@/components/ui';
import { CreateTemplateForm } from './CreateTemplateForm';

export const metadata = { title: 'Checklists' };

export default async function TemplatesPage() {
  const user = await requireManager();
  const templates = await listTemplates(user.restaurantId);
  const stations = await query<{ id: number; name: string }>(
    `select s.id, s.name from stations s
      where s.restaurant_id = $1 and s.active
        and not exists (select 1 from checklist_templates t where t.station_id = s.id and t.shift_type = 'opening')
      order by s.name`,
    [user.restaurantId],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Checklists</h1>
        <p className="text-muted">
          Edit the tasks employees see. Saving creates a new version; checklists already started or submitted keep the tasks they were given.
        </p>
      </div>

      <Card>
        <ul className="divide-y divide-line">
          {templates.length === 0 && <li className="px-5 py-6 text-sm text-muted">No checklists yet.</li>}
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-semibold">{t.name}</p>
                <p className="text-sm text-muted">
                  {t.station_name} · {t.task_count} task{t.task_count === 1 ? '' : 's'} · version {t.version_number}
                  {t.version_created_at && ` · saved ${formatDateTime(t.version_created_at, user.timezone)}`}
                  {t.version_created_by_name && ` by ${t.version_created_by_name}`}
                </p>
              </div>
              <Link href={`/manager/templates/${t.id}`} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold">
                Edit tasks
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {stations.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-bold">New opening checklist</h2>
          <CreateTemplateForm stations={stations} />
        </Card>
      )}
    </div>
  );
}
