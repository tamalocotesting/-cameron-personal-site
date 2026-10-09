import { requireManager } from '@/lib/auth';
import { query } from '@/lib/db';
import { Badge, Card } from '@/components/ui';
import { AddStaffForm, EditStaffForm } from './StaffForms';

export const metadata = { title: 'Staff' };

export default async function StaffPage() {
  const user = await requireManager();
  const [people, stations] = await Promise.all([
    query<{ id: number; username: string; display_name: string; role: string; station_id: number | null; station_name: string | null; active: boolean; locked: boolean }>(
      `select u.id, u.username, u.display_name, u.role, u.station_id, s.name as station_name, u.active,
              coalesce(u.locked_until > now(), false) as locked
         from users u left join stations s on s.id = u.station_id
        where u.restaurant_id = $1
        order by u.active desc, u.role desc, u.display_name`,
      [user.restaurantId],
    ),
    query<{ id: number; name: string }>('select id, name from stations where restaurant_id = $1 and active order by name', [user.restaurantId]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
        <p className="text-muted">Add people, assign their station, reset forgotten passwords, and turn off access when someone leaves.</p>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 font-bold">Add a person</h2>
        <AddStaffForm stations={stations} />
      </Card>

      <Card>
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.id} className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{p.display_name}</p>
                <span className="text-sm text-muted">@{p.username}</span>
                <Badge tone={p.role === 'manager' ? 'neutral' : 'done'}>{p.role === 'manager' ? 'Manager' : 'Employee'}</Badge>
                {!p.active && <Badge tone="blocked">Turned off</Badge>}
                {p.locked && <Badge tone="warn">Locked after failed sign-ins</Badge>}
              </div>
              <EditStaffForm person={p} stations={stations} isSelf={p.id === user.id} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
