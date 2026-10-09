import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth';
import { getTemplate, getVersionTasks, listVersions } from '@/lib/templates';
import { formatDateTime } from '@/lib/time';
import { Card } from '@/components/ui';
import { TemplateEditor } from './TemplateEditor';

export const metadata = { title: 'Edit checklist' };

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; version?: string }>;
}) {
  const user = await requireManager();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const template = await getTemplate(id, user.restaurantId);
  if (!template) notFound();
  const { saved, version } = await searchParams;
  const [tasks, versions] = await Promise.all([template.version_id ? getVersionTasks(template.version_id) : [], listVersions(id)]);
  const viewing = version ? versions.find((v) => v.version_number === Number(version)) : undefined;
  const viewingTasks = viewing ? await getVersionTasks(viewing.id) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <div>
          <Link href="/manager/templates" className="text-sm font-semibold text-navy-600">
            ← Checklists
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Edit checklist</h1>
          <p className="text-muted">
            {template.station_name} · currently version {template.version_number}
          </p>
        </div>
        {saved && (
          <p role="status" className="rounded-lg bg-done-soft px-4 py-3 text-sm font-semibold text-done">
            Saved as version {template.version_number}. New checklists will use it.
          </p>
        )}
        <TemplateEditor
          key={template.version_id ?? 0}
          templateId={template.id}
          baseVersionId={template.version_id}
          initialName={template.name}
          initialTasks={tasks.map((t) => ({ description: t.description, required: t.required }))}
        />
      </div>

      <aside className="space-y-4">
        <Card>
          <h2 className="border-b border-line px-4 py-3 font-bold">Version history</h2>
          <ul className="divide-y divide-line text-sm">
            {versions.map((v) => (
              <li key={v.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/manager/templates/${id}?version=${v.version_number}`} className="font-semibold text-navy-600 hover:underline">
                    Version {v.version_number}
                  </Link>
                  {v.id === template.version_id && <span className="text-xs font-semibold text-done">Current</span>}
                </div>
                <p className="text-xs text-muted">
                  {formatDateTime(v.created_at, user.timezone)}
                  {v.created_by_name && ` · ${v.created_by_name}`} · {v.task_count} tasks · used by {v.runs_using} checklist
                  {v.runs_using === 1 ? '' : 's'}
                </p>
                {v.change_note && <p className="mt-1 text-xs">{v.change_note}</p>}
              </li>
            ))}
          </ul>
        </Card>
        {viewing && (
          <Card className="p-4">
            <h2 className="font-bold">Version {viewing.version_number} tasks</h2>
            <p className="text-xs text-muted">{viewing.name}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {viewingTasks.map((t) => (
                <li key={t.id}>
                  {t.description}
                  {!t.required && <span className="text-muted"> (optional)</span>}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </aside>
    </div>
  );
}
