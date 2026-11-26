/** API, permissions, audit, imports and assistant loop — against an in-memory database with synthetic data. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb, setDb, run, one, all, type DB } from '../server/db.ts';
import { hashSecret } from '../server/auth.ts';
import { DEFAULT_ASSUMPTIONS } from '../server/domain/assumptions.ts';
import { addDays, dow } from '../server/domain/calendar.ts';
import { createApp } from '../server/app.ts';
import { ask, type MessagesClient } from '../server/assistant/loop.ts';
import { applyImport } from '../server/imports/toast.ts';

let db: DB; let base = ''; let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const PW = 'correct-horse-battery';

function seedSynthetic(d: DB) {
  const start = '2026-06-01';
  for (let i = 0; i < 150; i++) {
    const date = addDays(start, i);
    const tot = [150, 150, 180, 190, 280, 520, 520][dow(date)];
    run(d, "INSERT INTO bagel_day(date,status,total) VALUES (?, 'recorded', ?)", date, tot);
    run(d, 'INSERT INTO bagel_daily(date,flavor,units) VALUES (?,?,?),(?,?,?)', date, 'Plain', tot * 0.6, date, 'Everything', tot * 0.4);
    run(d, "INSERT INTO daily_sales(date,net_sales,orders,status) VALUES (?,?,?,'actual')", date, tot * 9, tot / 3);
  }
  for (const m of ['2026-08', '2026-09', '2026-10']) {
    run(d, "INSERT INTO item_monthly(month,item,menu_group,qty) VALUES (?, 'Pick Me Up', 'Sandwiches', 900), (?, 'Rise & Grind', 'Sandwiches', 600)", m, m);
    run(d, "INSERT INTO modifier_monthly(month,option_group,parent,modifier,qty) VALUES (?, 'Spreads - Cream Cheeses & Butters', 'Single Bagel', 'Plain CC', 700), (?, 'Add Protein', 'Pick Me Up', 'Bacon', 30)", m, m);
  }
  run(d, "INSERT INTO menu_items(name,kind,bagels_per_unit,recipe_id) VALUES ('Pick Me Up','sandwich',1,'pick_me_up'),('Rise & Grind','sandwich',1,'rise_grind')");
  run(d, "INSERT INTO recipes(id,name,kind) VALUES ('pick_me_up','Pick Me Up','sandwich'),('rise_grind','Rise & Grind','sandwich')");
  run(d, "INSERT INTO recipe_components(recipe_id,component,qty,unit) VALUES ('pick_me_up','bacon_strip',2,'strip'),('pick_me_up','egg_oz',4,'oz'),('rise_grind','sausage_patty',1,'each'),('rise_grind','egg_oz',4,'oz')");
  for (const a of DEFAULT_ASSUMPTIONS) run(d, 'INSERT INTO assumptions(key,value,unit,label,category,status,basis) VALUES (?,?,?,?,?,?,?)', a.key, a.value, a.unit, a.label, a.category, a.status, a.basis);
  for (const [u, role, s] of [['crew1', 'crew', '1234'], ['lead1', 'lead', '5678'], ['mgr', 'manager', PW], ['boss', 'owner', PW]]) run(d, 'INSERT INTO users(username,display_name,role,secret_hash) VALUES (?,?,?,?)', u, u, role, hashSecret(s));
}

before(async () => {
  process.env.BSB_TODAY = '2026-10-29';
  process.env.BSB_INSECURE_COOKIE = '1';
  delete process.env.ANTHROPIC_API_KEY;
  db = openDb(':memory:'); seedSynthetic(db); setDb(db);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function login(username: string, secret: string) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, secret }) });
  const body = await r.json();
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const call = (path: string, opts: { method?: string; body?: unknown; csrf?: boolean } = {}) => fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { cookie, 'content-type': 'application/json', ...(opts.csrf === false ? {} : { 'x-csrf': body.csrf }) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, body, call };
}

test('login works, wrong PIN fails and is audited, lockout after 5 failures', async () => {
  assert.equal((await login('crew1', '1234')).status, 200);
  assert.equal((await login('crew1', '0000')).status, 401);
  assert.ok(one(db, "SELECT 1 FROM audit_log WHERE action='login.fail'"));
  for (let i = 0; i < 5; i++) await login('lead1', '0000');
  assert.equal((await login('lead1', '5678')).status, 401, 'locked out even with right PIN');
  run(db, 'UPDATE users SET locked_until=NULL, failed_attempts=0 WHERE username=?', 'lead1');
});

test('unauthenticated requests are refused', async () => {
  assert.equal((await fetch(base + '/api/plan')).status, 401);
});

test('crew sees the plan but never sales dollars; roles enforced server-side', async () => {
  const c = await login('crew1', '1234');
  const plan = await (await c.call('/api/plan?date=2026-10-30')).json();
  assert.ok(plan.bagels.total.value > 0);
  assert.equal(JSON.stringify(plan).includes('net_sales'), false);
  assert.equal((await c.call('/api/history/sales')).status, 403);
  assert.equal((await c.call('/api/accuracy')).status, 403);
  assert.equal((await c.call('/api/users')).status, 403);
  assert.equal((await c.call('/api/tickets/adjust', { body: { date: '2026-10-30', key: 'bake:Plain', qty: 1, reason: 'test' } })).status, 403);
  const meta = await (await c.call('/api/meta')).json();
  assert.equal(meta.salesEnd, undefined, 'sales coverage hidden from crew');
});

test('state changes require the CSRF header and write an audit record', async () => {
  const c = await login('crew1', '1234');
  assert.equal((await c.call('/api/tickets/status', { body: { date: '2026-10-30', key: 'bake:Plain', status: 'done' }, csrf: false })).status, 403);
  assert.equal((await c.call('/api/tickets/status', { body: { date: '2026-10-30', key: 'bake:Plain', status: 'done' } })).status, 200);
  assert.ok(one(db, "SELECT 1 FROM audit_log WHERE action='ticket.status' AND entity_id='2026-10-30:bake:Plain'"));
  const plan = await (await c.call('/api/plan?date=2026-10-30')).json();
  assert.equal(plan.tickets.find((t: any) => t.key === 'bake:Plain').status, 'done');
});

test('lead adjustments need a reason, are audited, and show on the ticket', async () => {
  const l = await login('lead1', '5678');
  assert.equal((await l.call('/api/tickets/adjust', { body: { date: '2026-10-30', key: 'bake:Plain', qty: 200 } })).status, 400);
  assert.equal((await l.call('/api/tickets/adjust', { body: { date: '2026-10-30', key: 'bake:Plain', qty: 200, reason: 'School order confirmed' } })).status, 200);
  const plan = await (await l.call('/api/plan?date=2026-10-30')).json();
  assert.equal(plan.tickets.find((t: any) => t.key === 'bake:Plain').adjusted.qty, 200);
  const a = one<{ reason: string }>(db, "SELECT reason FROM audit_log WHERE action='ticket.adjust'");
  assert.equal(a?.reason, 'School order confirmed');
});

test('catering is added on top of the forecast, not double counted', async () => {
  const l = await login('lead1', '5678');
  const before = await (await l.call('/api/plan?date=2026-10-31')).json();
  await l.call('/api/catering', { body: { date: '2026-10-31', label: 'Office #1', bagels: { Plain: 24 }, status: 'confirmed' } });
  const after = await (await l.call('/api/plan?date=2026-10-31')).json();
  assert.equal(after.bagels.bakeTotal, before.bagels.bakeTotal + 24);
  assert.equal(after.bagels.total.value, before.bagels.total.value, 'walk-in forecast unchanged');
});

test('inventory counts net the cream cheese and pull plans; missing counts stay missing', async () => {
  const c = await login('crew1', '1234');
  const p0 = await (await c.call('/api/plan?date=2026-10-30')).json();
  const plain0 = p0.cream.find((x: any) => x.flavor === 'Plain');
  assert.equal(plain0.onHandLb.kind, 'missing');
  assert.equal(plain0.onHandLb.value, null);
  await c.call('/api/inventory', { body: { date: '2026-10-30', counts: [{ item: 'cream_cheese:Plain', state: 'bulk_lb', qty: 2, unit: 'lb' }, { item: 'Plain', state: 'thawed', qty: 500, unit: 'bagels' }] } });
  const p1 = await (await c.call('/api/plan?date=2026-10-30')).json();
  const plain1 = p1.cream.find((x: any) => x.flavor === 'Plain');
  assert.equal(plain1.onHandLb.value, 2);
  assert.ok(Math.abs(plain1.toMakeLb.value - Math.max(0, plain0.toMakeLb.value - 2)) < 0.11);
  assert.equal(p1.pull.flavors.Plain.carryKind, 'verified');
});

test('assumptions: only managers edit, reason required, plan reacts, audit records before/after', async () => {
  const c = await login('crew1', '1234');
  assert.equal((await c.call('/api/assumptions/bacon_per_addon', { method: 'PUT', body: { value: 3, reason: 'x' } })).status, 403);
  const m = await login('mgr', PW);
  const before = await (await m.call('/api/plan?date=2026-10-30')).json();
  assert.equal((await m.call('/api/assumptions/protein_buffer_pct', { method: 'PUT', body: { value: 0 } })).status, 400);
  assert.equal((await m.call('/api/assumptions/protein_buffer_pct', { method: 'PUT', body: { value: 0, reason: 'Testing no buffer' } })).status, 200);
  const after = await (await m.call('/api/plan?date=2026-10-30')).json();
  assert.ok(after.proteins.bacon.value < before.proteins.bacon.value);
  const a = one<{ before_json: string; after_json: string }>(db, "SELECT before_json, after_json FROM audit_log WHERE action='assumption.update'");
  assert.equal(JSON.parse(a!.before_json).value, 10);
  assert.equal(JSON.parse(a!.after_json).value, 0);
});

test('owner-only: users, audit log, backups; cannot remove last owner', async () => {
  const m = await login('mgr', PW);
  assert.equal((await m.call('/api/audit')).status, 403);
  const o = await login('boss', PW);
  assert.equal((await o.call('/api/audit')).status, 200);
  const owner = one<{ id: number }>(db, "SELECT id FROM users WHERE username='boss'")!;
  assert.equal((await o.call(`/api/users/${owner.id}`, { method: 'PUT', body: { role: 'manager' } })).status, 400);
  assert.equal((await o.call('/api/users', { body: { username: 'newbie', role: 'crew', secret: '12' } })).status, 400, 'PIN too short');
  assert.equal((await o.call('/api/users', { body: { username: 'newbie', role: 'crew', secret: '424242' } })).status, 200);
});

test('Toast modifier import updates bagel history, is idempotent, and asks before replacing', async () => {
  const csv = ['Sent Date,Option Group Name,Parent Menu Selection,Modifier,Qty,Void?',
    '11/01/26 7:01 AM,Bagel Choices,Pick Me Up,Everything Bagel,1,false',
    '11/01/26 7:02 AM,Dozen Bagels,Dozen Bagels,Plain Bagel,8,false',
    '11/01/26 7:02 AM,Dozen Bagels,Dozen Bagels,Sesame Bagel,4,false',
    '11/01/26 7:03 AM,Bagel Choices,Single Bagel,Plain Bagel,1,true',
    '11/01/26 7:04 AM,Spreads - Cream Cheeses & Butters,Single Bagel,Plain CC,1,false'].join('\n');
  const actor = { id: null, username: 'test' };
  const r1 = applyImport(db, actor, csv, 'mods.csv');
  assert.equal(r1.applied, true);
  assert.equal(r1.voidRows, 1);
  const day = one<{ status: string; total: number }>(db, "SELECT status,total FROM bagel_day WHERE date='2026-11-01'");
  assert.deepEqual({ ...day }, { status: 'recorded', total: 13 }, 'sandwich 1 + dozen 12; voided single excluded; spread is not a bagel');
  assert.equal(applyImport(db, actor, csv, 'mods.csv').applied, false, 'same file twice is a no-op');
  const csv2 = csv.replace('Sesame Bagel,4', 'Sesame Bagel,5');
  const r3 = applyImport(db, actor, csv2, 'mods-v2.csv');
  assert.equal(r3.applied, false); assert.equal(r3.overlap.length, 1);
  assert.equal(applyImport(db, actor, csv2, 'mods-v2.csv', { replace: true }).applied, true);
  assert.equal(one<{ total: number }>(db, "SELECT total FROM bagel_day WHERE date='2026-11-01'")!.total, 14);
  assert.ok(one(db, "SELECT 1 FROM audit_log WHERE action='history.replace' AND entity_id='2026-11-01'"));
});

test('Ask B’s: tool loop, sources, follow-up context, and permission refusal (scripted model)', async () => {
  const calls: Record<string, unknown>[] = [];
  const script = [
    { stop_reason: 'tool_use', model: 'test', content: [{ type: 'tool_use', id: 't1', name: 'get_bagel_history', input: { from: '2026-10-01', to: '2026-10-07' } }, { type: 'tool_use', id: 't2', name: 'get_sales', input: { from: '2026-10-01', to: '2026-10-07' } }] },
    { stop_reason: 'tool_use', model: 'test', content: [{ type: 'tool_use', id: 't3', name: 'calculate', input: { expression: '1000/7' } }] },
    { stop_reason: 'end_turn', model: 'test', content: [{ type: 'text', text: 'Verified: 1,000+ bagels that week.' }] },
  ];
  const client: MessagesClient = { beta: { messages: { create: async (p) => { calls.push(structuredClone(p)); return script.shift()! as never; } } } };
  const user = one<any>(db, "SELECT id,username,display_name,role,lang,station FROM users WHERE username='crew1'");
  const r = await ask(db, user, [{ role: 'user', content: 'How many bagels first week of October?' }], '2026-10-29', client);
  assert.equal(r.answer, 'Verified: 1,000+ bagels that week.');
  assert.equal(r.sources.length, 3);
  assert.match(r.sources[1].error ?? '', /PERMISSION/, 'crew cannot read sales through the assistant');
  const toolNames = ((calls[0].tools as { name: string }[]).map((t) => t.name));
  assert.ok(!toolNames.includes('get_sales'), 'sales tool not even offered to crew');
  const results = (calls[1].messages as any[]).at(-1).content;
  assert.equal(results.length, 2, 'both tool results returned in one user message');
  assert.equal(results[1].is_error, true);
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.ok(one(db, "SELECT 1 FROM audit_log WHERE action='assistant.ask'"));
});

test('assistant without a key degrades gracefully', async () => {
  const c = await login('crew1', '1234');
  const r = await (await c.call('/api/ask', { body: { history: [{ role: 'user', content: 'hi' }] } })).json();
  assert.equal(r.stop, 'not_configured');
});

test('exports are manager-only, restricted to safe tables, and audited', async () => {
  const c = await login('crew1', '1234');
  assert.equal((await c.call('/api/export/bagel_day.csv')).status, 403);
  const m = await login('mgr', PW);
  const r = await m.call('/api/export/bagel_day.csv');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /^date,status,total/);
  assert.equal((await m.call('/api/export/users.csv')).status, 404);
  assert.ok(all(db, "SELECT 1 FROM audit_log WHERE action='export.csv'").length >= 1);
});
