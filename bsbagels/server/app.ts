/**
 * HTTP API. Every route declares a minimum role; state-changing routes require the CSRF header and
 * write an audit record. Sales dollars never leave the server for roles below manager.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, all, one, run, tx, ROOT, type DB } from './db.ts';
import { login, createSession, destroySession, sessionUser, atLeast, hashSecret, verifySecret, validateSecret, type Role, type SessionUser } from './auth.ts';
import { audit } from './audit.ts';
import { buildPlan } from './domain/plan.ts';
import { loadSeries } from './domain/history.ts';
import { walkForward, scoreTable, byWeekday, bias } from './domain/backtest.ts';
import { MODEL_ID } from './domain/forecast.ts';
import { addDays, dateRange } from './domain/calendar.ts';
import { previewImport, applyImport, type ImportKind } from './imports/toast.ts';
import { createBackup, listBackups, backupPath, restoreBackup, EXPORTABLE, toCsv } from './backup.ts';
import { ask, MODEL, type AskTurn } from './assistant/loop.ts';

type Req = Request & { user?: SessionUser & { csrf: string }; token?: string };
const COOKIE = 'rail_s';
const SECURE_COOKIE = process.env.BSB_INSECURE_COOKIE !== '1';

export function businessToday(): string {
  if (process.env.BSB_TODAY) return process.env.BSB_TODAY;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Indiana/Indianapolis' }).format(new Date());
}

const isoDate = (v: unknown, fallback?: string) => {
  const s = typeof v === 'string' ? v : fallback;
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw httpError(400, 'Invalid date');
  return s;
};
function httpError(status: number, message: string) { return Object.assign(new Error(message), { status }); }
const actor = (r: Req) => ({ id: r.user!.id, username: r.user!.username });

function cookie(req: Request, name: string) {
  const h = req.headers.cookie ?? '';
  for (const part of h.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return undefined;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '30mb' }));

  const db = () => getDb();

  // ── session middleware ──
  app.use('/api', (req: Req, _res, next) => {
    const t = cookie(req, COOKIE);
    if (t) { const u = sessionUser(db(), t); if (u) { req.user = u; req.token = t; } }
    next();
  });
  const need = (min: Role) => (req: Req, _res: Response, next: NextFunction) => {
    if (!req.user) return next(httpError(401, 'Sign in required'));
    if (!atLeast(req.user.role, min)) return next(httpError(403, `Requires ${min} role`));
    if (req.method !== 'GET' && req.headers['x-csrf'] !== req.user.csrf) return next(httpError(403, 'Bad CSRF token — reload the page'));
    next();
  };

  // ── auth ──
  app.get('/api/roster', (_req, res) => {
    if (process.env.BSB_HIDE_ROSTER === '1') return res.json([]);
    res.json(all(db(), "SELECT username, display_name, role FROM users WHERE active=1 AND role IN ('crew','lead') ORDER BY display_name"));
  });
  app.post('/api/login', (req: Req, res) => {
    const { username, secret } = req.body ?? {};
    if (typeof username !== 'string' || typeof secret !== 'string') throw httpError(400, 'username and secret required');
    const r = login(db(), username, secret);
    if (!r.user) { audit(db(), { id: null, username: String(username).slice(0, 40) }, 'login.fail', 'users', null, null, null); throw httpError(401, r.error!); }
    const s = createSession(db(), r.user);
    audit(db(), { id: r.user.id, username: r.user.username }, 'login.ok', 'users', r.user.id, null, null);
    res.setHeader('Set-Cookie', `${COOKIE}=${s.token}; HttpOnly; SameSite=Strict; Path=/; Expires=${s.expires.toUTCString()}${SECURE_COOKIE ? '; Secure' : ''}`);
    res.json({ user: r.user, csrf: s.csrf });
  });
  app.post('/api/logout', (req: Req, res) => {
    if (req.token) destroySession(db(), req.token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE_COOKIE ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.get('/api/me', (req: Req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    const { csrf, ...user } = req.user;
    res.json({ user, csrf });
  });
  app.put('/api/me', need('crew'), (req: Req, res) => {
    const { lang, current, next: nextSecret } = req.body ?? {};
    if (lang && ['en', 'es'].includes(lang)) run(db(), 'UPDATE users SET lang=? WHERE id=?', lang, req.user!.id);
    if (nextSecret) {
      const row = one<{ secret_hash: string }>(db(), 'SELECT secret_hash FROM users WHERE id=?', req.user!.id)!;
      if (!current || !verifySecret(current, row.secret_hash)) throw httpError(400, 'Current PIN/password is wrong');
      const err = validateSecret(req.user!.role, nextSecret); if (err) throw httpError(400, err);
      run(db(), 'UPDATE users SET secret_hash=? WHERE id=?', hashSecret(nextSecret), req.user!.id);
      run(db(), 'DELETE FROM sessions WHERE user_id=? AND token_hash != ?', req.user!.id, '');
      audit(db(), actor(req), 'user.secret_change', 'users', req.user!.id, null, null);
    }
    res.json(one(db(), 'SELECT id,username,display_name,role,lang,station FROM users WHERE id=?', req.user!.id));
  });

  // ── meta ──
  app.get('/api/meta', need('crew'), (req: Req, res) => {
    res.json({
      today: businessToday(), model: MODEL_ID, assistantModel: MODEL, assistantConfigured: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      historyEnd: one<{ d: string }>(db(), "SELECT max(date) d FROM bagel_day WHERE status='recorded'")?.d,
      salesEnd: atLeast(req.user!.role, 'manager') ? one<{ d: string }>(db(), "SELECT max(date) d FROM daily_sales WHERE status='actual'")?.d : undefined,
      flavors: all(db(), 'SELECT name,name_es,short,gluten_free,active FROM flavors ORDER BY sort'),
    });
  });

  // ── plan ──
  app.get('/api/plan', need('crew'), (req: Req, res) => {
    const date = isoDate(req.query.date, businessToday());
    const p = buildPlan(db(), date);
    // Freeze genuine forward forecasts so accuracy can be scored against what crew saw.
    if (date > p.historyEnd && p.bagels.total.value !== null) {
      run(db(), `INSERT OR IGNORE INTO forecast_snapshots(target_date,made_on,model,total_point,total_lo,total_hi,flavors_json,detail_json) VALUES (?,?,?,?,?,?,?,?)`,
        date, p.historyEnd, p.model, p.bagels.total.value, p.bagels.total.lo ?? null, p.bagels.total.hi ?? null,
        JSON.stringify(Object.fromEntries(Object.entries(p.bagels.walkInFlavors).map(([k, f]) => [k, f.value]))), JSON.stringify({ sandwiches: p.sandwiches.total.value, bacon: p.proteins.bacon.value, sausage: p.proteins.sausage.value }));
    }
    res.json(p);
  });
  app.get('/api/outlook', need('manager'), (req, res) => {
    const start = isoDate(req.query.from, businessToday());
    const n = Math.min(28, Math.max(1, +(req.query.days ?? 14) || 14));
    res.json(Array.from({ length: n }, (_, i) => {
      const p = buildPlan(db(), addDays(start, i));
      return { date: p.date, weekday: p.weekday, holiday: p.holiday?.name ?? null, closed: p.closedLikely, total: p.bagels.total, sandwiches: p.sandwiches.total.value, bacon: p.proteins.bacon.value, sausage: p.proteins.sausage.value, eggs: p.proteins.shellEggs.value };
    }));
  });
  app.post('/api/tickets/status', need('crew'), (req: Req, res) => {
    const { date, key, status, qty_done, note } = req.body ?? {};
    const d = isoDate(date);
    if (typeof key !== 'string' || key.length > 80) throw httpError(400, 'Bad ticket key');
    tx(db(), () => {
      const before = one(db(), 'SELECT * FROM ticket_status WHERE date=? AND ticket_key=?', d, key);
      if (status === null || status === 'open') run(db(), 'DELETE FROM ticket_status WHERE date=? AND ticket_key=?', d, key);
      else {
        if (!['done', 'skipped', 'partial'].includes(status)) throw httpError(400, 'Bad status');
        run(db(), `INSERT INTO ticket_status(date,ticket_key,status,qty_done,note,user_id) VALUES (?,?,?,?,?,?) ON CONFLICT(date,ticket_key) DO UPDATE SET status=excluded.status, qty_done=excluded.qty_done, note=excluded.note, user_id=excluded.user_id, at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
          d, key, status, typeof qty_done === 'number' ? qty_done : null, typeof note === 'string' ? note.slice(0, 500) : null, req.user!.id);
      }
      audit(db(), actor(req), 'ticket.status', 'ticket', `${d}:${key}`, before, { status, qty_done, note });
    });
    res.json({ ok: true });
  });
  app.post('/api/tickets/adjust', need('lead'), (req: Req, res) => {
    const { date, key, qty, reason } = req.body ?? {};
    const d = isoDate(date);
    if (typeof key !== 'string') throw httpError(400, 'Bad ticket key');
    tx(db(), () => {
      const before = one(db(), 'SELECT * FROM plan_adjustments WHERE date=? AND ticket_key=?', d, key);
      if (qty === null) run(db(), 'DELETE FROM plan_adjustments WHERE date=? AND ticket_key=?', d, key);
      else {
        if (typeof qty !== 'number' || qty < 0 || qty > 100000) throw httpError(400, 'Bad quantity');
        if (typeof reason !== 'string' || reason.trim().length < 3) throw httpError(400, 'A reason is required for adjustments');
        run(db(), `INSERT INTO plan_adjustments(date,ticket_key,qty,reason,user_id) VALUES (?,?,?,?,?) ON CONFLICT(date,ticket_key) DO UPDATE SET qty=excluded.qty, reason=excluded.reason, user_id=excluded.user_id, at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, d, key, qty, reason.trim().slice(0, 300), req.user!.id);
      }
      audit(db(), actor(req), 'ticket.adjust', 'ticket', `${d}:${key}`, before, { qty, reason }, reason);
    });
    res.json({ ok: true });
  });

  // ── handoffs, waste, inventory ──
  app.get('/api/handoffs', need('crew'), (req, res) => {
    const d = isoDate(req.query.date, businessToday());
    res.json(all(db(), `SELECT h.*, u.display_name author FROM handoffs h LEFT JOIN users u ON u.id=h.user_id WHERE h.date BETWEEN ? AND ? ORDER BY h.at DESC`, addDays(d, -6), d));
  });
  app.post('/api/handoffs', need('crew'), (req: Req, res) => {
    const { date, shift, note, flags } = req.body ?? {};
    if (!['open', 'mid', 'close'].includes(shift) || typeof note !== 'string' || !note.trim()) throw httpError(400, 'shift and note required');
    const r = run(db(), 'INSERT INTO handoffs(date,shift,note,flags_json,user_id) VALUES (?,?,?,?,?)', isoDate(date), shift, note.trim().slice(0, 2000), JSON.stringify(Array.isArray(flags) ? flags.slice(0, 10) : []), req.user!.id);
    audit(db(), actor(req), 'handoff.create', 'handoffs', Number(r.lastInsertRowid), null, { shift, note });
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.get('/api/waste', need('crew'), (req, res) => {
    const d = isoDate(req.query.date, businessToday());
    res.json(all(db(), `SELECT w.*, u.display_name who FROM waste_log w LEFT JOIN users u ON u.id=w.user_id WHERE w.date BETWEEN ? AND ? ORDER BY w.at DESC`, addDays(d, -13), d));
  });
  app.post('/api/waste', need('crew'), (req: Req, res) => {
    const { date, item, qty, unit, reason } = req.body ?? {};
    if (typeof item !== 'string' || !item || typeof qty !== 'number' || qty <= 0 || qty > 10000) throw httpError(400, 'item and positive qty required');
    const reasons = ['end_of_day', 'burnt', 'dropped', 'expired', 'quality', 'other'];
    const r = run(db(), 'INSERT INTO waste_log(date,item,qty,unit,reason,user_id) VALUES (?,?,?,?,?,?)', isoDate(date), item.slice(0, 80), qty, typeof unit === 'string' ? unit.slice(0, 20) : 'each', reasons.includes(reason) ? reason : 'other', req.user!.id);
    audit(db(), actor(req), 'waste.create', 'waste_log', Number(r.lastInsertRowid), null, { item, qty, unit, reason });
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.delete('/api/waste/:id', need('lead'), (req: Req, res) => {
    const before = one(db(), 'SELECT * FROM waste_log WHERE id=?', +req.params.id);
    if (!before) throw httpError(404, 'Not found');
    run(db(), 'DELETE FROM waste_log WHERE id=?', +req.params.id);
    audit(db(), actor(req), 'waste.delete', 'waste_log', +req.params.id, before, null, req.body?.reason);
    res.json({ ok: true });
  });
  app.get('/api/inventory', need('crew'), (_req, res) => {
    res.json(all(db(), `SELECT i.*, u.display_name who FROM inventory_counts i LEFT JOIN users u ON u.id=i.user_id JOIN (SELECT item,state,max(counted_at) m FROM inventory_counts GROUP BY item,state) x ON x.item=i.item AND x.state=i.state AND x.m=i.counted_at ORDER BY i.item,i.state`));
  });
  app.post('/api/inventory', need('crew'), (req: Req, res) => {
    const { date, counts } = req.body ?? {};
    const d = isoDate(date);
    if (!Array.isArray(counts) || !counts.length || counts.length > 100) throw httpError(400, 'counts[] required');
    const states = ['frozen', 'thawed', 'baked', 'bulk_lb', 'tub_8oz', 'cooked', 'raw'];
    tx(db(), () => {
      for (const c of counts) {
        if (typeof c.item !== 'string' || !states.includes(c.state) || typeof c.qty !== 'number' || c.qty < 0 || c.qty > 100000) throw httpError(400, 'Bad count row');
        run(db(), 'INSERT INTO inventory_counts(counted_at,business_date,item,state,qty,unit,user_id,note) VALUES (?,?,?,?,?,?,?,?)', new Date().toISOString(), d, c.item.slice(0, 60), c.state, c.qty, typeof c.unit === 'string' ? c.unit.slice(0, 20) : 'each', req.user!.id, typeof c.note === 'string' ? c.note.slice(0, 200) : null);
      }
      audit(db(), actor(req), 'inventory.count', 'inventory_counts', d, null, counts);
    });
    res.json({ ok: true });
  });

  // ── catering ──
  app.get('/api/catering', need('crew'), (req, res) => {
    const from = isoDate(req.query.from, addDays(businessToday(), -7));
    res.json(all(db(), `SELECT c.*, u.display_name created_by_name FROM catering_orders c LEFT JOIN users u ON u.id=c.created_by WHERE date >= ? ORDER BY date, ready_by`, from));
  });
  const cateringBody = (b: Record<string, unknown>) => {
    const obj = (v: unknown) => { const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>; const out: Record<string, number> = {}; for (const [k, n] of Object.entries(o)) if (typeof n === 'number' && n > 0 && n < 10000) out[k.slice(0, 60)] = Math.round(n); return JSON.stringify(out); };
    if (typeof b.label !== 'string' || !b.label.trim()) throw httpError(400, 'label required');
    return { date: isoDate(b.date), ready_by: typeof b.ready_by === 'string' ? b.ready_by.slice(0, 10) : null, label: b.label.trim().slice(0, 80), bagels: obj(b.bagels), sandwiches: obj(b.sandwiches), spreads: obj(b.spreads), notes: typeof b.notes === 'string' ? b.notes.slice(0, 1000) : null, status: ['tentative', 'confirmed', 'cancelled', 'done'].includes(b.status as string) ? b.status as string : 'confirmed' };
  };
  app.post('/api/catering', need('lead'), (req: Req, res) => {
    const c = cateringBody(req.body ?? {});
    const r = run(db(), 'INSERT INTO catering_orders(date,ready_by,label,bagels_json,sandwiches_json,spreads_json,notes,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)', c.date, c.ready_by, c.label, c.bagels, c.sandwiches, c.spreads, c.notes, c.status, req.user!.id);
    audit(db(), actor(req), 'catering.create', 'catering_orders', Number(r.lastInsertRowid), null, c);
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/catering/:id', need('lead'), (req: Req, res) => {
    const before = one(db(), 'SELECT * FROM catering_orders WHERE id=?', +req.params.id);
    if (!before) throw httpError(404, 'Not found');
    const c = cateringBody(req.body ?? {});
    run(db(), 'UPDATE catering_orders SET date=?,ready_by=?,label=?,bagels_json=?,sandwiches_json=?,spreads_json=?,notes=?,status=? WHERE id=?', c.date, c.ready_by, c.label, c.bagels, c.sandwiches, c.spreads, c.notes, c.status, +req.params.id);
    audit(db(), actor(req), 'catering.update', 'catering_orders', +req.params.id, before, c);
    res.json({ ok: true });
  });

  // ── checklists ──
  app.get('/api/checklists', need('crew'), (req, res) => {
    const d = isoDate(req.query.date, businessToday());
    const lists = all<{ id: string; items_json: string }>(db(), 'SELECT * FROM checklists ORDER BY id DESC');
    const ticks = all<{ checklist_id: string; item_id: string; at: string; who: string }>(db(), 'SELECT r.checklist_id,r.item_id,r.at,u.display_name who FROM checklist_runs r LEFT JOIN users u ON u.id=r.user_id WHERE r.date=?', d);
    res.json(lists.map((l) => ({ ...l, items: JSON.parse(l.items_json), ticks: ticks.filter((t) => t.checklist_id === l.id) })));
  });
  app.post('/api/checklists/tick', need('crew'), (req: Req, res) => {
    const { date, checklist_id, item_id, done } = req.body ?? {};
    const d = isoDate(date);
    if (done) run(db(), 'INSERT OR IGNORE INTO checklist_runs(date,checklist_id,item_id,user_id) VALUES (?,?,?,?)', d, String(checklist_id), String(item_id), req.user!.id);
    else run(db(), 'DELETE FROM checklist_runs WHERE date=? AND checklist_id=? AND item_id=?', d, String(checklist_id), String(item_id));
    audit(db(), actor(req), 'checklist.tick', 'checklist', `${d}:${checklist_id}:${item_id}`, null, { done: !!done });
    res.json({ ok: true });
  });
  app.put('/api/checklists/:id', need('manager'), (req: Req, res) => {
    const before = one<{ items_json: string; status: string }>(db(), 'SELECT * FROM checklists WHERE id=?', req.params.id);
    if (!before) throw httpError(404, 'Not found');
    const { items, status } = req.body ?? {};
    const it = Array.isArray(items) ? items.filter((x) => typeof x.text === 'string').map((x, i) => ({ id: String(x.id ?? `n${i}`).slice(0, 20), station: String(x.station ?? 'all').slice(0, 10), text: x.text.slice(0, 300), text_es: String(x.text_es ?? '').slice(0, 300) })) : JSON.parse(before.items_json);
    const st = status === 'approved' || status === 'draft' ? status : before.status;
    run(db(), 'UPDATE checklists SET items_json=?, status=?, updated_at=?, updated_by=? WHERE id=?', JSON.stringify(it), st, new Date().toISOString(), req.user!.username, req.params.id);
    audit(db(), actor(req), 'checklist.update', 'checklists', String(req.params.id), before, { items: it, status: st });
    res.json({ ok: true });
  });

  // ── recipes & training ──
  app.get('/api/recipes', need('crew'), (req: Req, res) => {
    const recipes = all<{ id: string }>(db(), "SELECT r.*, (SELECT group_concat(name, ' · ') FROM menu_items m WHERE m.recipe_id=r.id) toast_items FROM recipes r ORDER BY kind DESC, name");
    const steps = all<{ recipe_id: string }>(db(), 'SELECT * FROM recipe_steps ORDER BY recipe_id, n');
    const comps = all<{ recipe_id: string }>(db(), 'SELECT * FROM recipe_components');
    const signed = all<{ recipe_id: string; at: string; signer: string }>(db(), 'SELECT t.recipe_id, t.at, u.display_name signer FROM training_signoffs t LEFT JOIN users u ON u.id=t.signed_by WHERE t.user_id=?', req.user!.id);
    res.json(recipes.map((r) => ({ ...r, steps: steps.filter((s) => s.recipe_id === r.id), components: comps.filter((c) => c.recipe_id === r.id), signoff: signed.find((s) => s.recipe_id === r.id) ?? null })));
  });
  app.put('/api/recipes/:id', need('manager'), (req: Req, res) => {
    const id = req.params.id;
    const before = one(db(), 'SELECT * FROM recipes WHERE id=?', id);
    if (!before) throw httpError(404, 'Not found');
    const { status, status_note, components } = req.body ?? {};
    tx(db(), () => {
      if (['source', 'needs_confirmation', 'approved'].includes(status)) run(db(), 'UPDATE recipes SET status=?, status_note=?, updated_at=? WHERE id=?', status, typeof status_note === 'string' ? status_note.slice(0, 500) : null, new Date().toISOString(), id);
      if (components && typeof components === 'object') for (const [k, v] of Object.entries(components)) if (typeof v === 'number' && v >= 0 && v < 100) run(db(), 'UPDATE recipe_components SET qty=? WHERE recipe_id=? AND component=?', v, id, k);
      audit(db(), actor(req), 'recipe.update', 'recipes', String(id), before, req.body);
    });
    res.json({ ok: true });
  });
  app.get('/api/training', need('lead'), (_req, res) => {
    res.json({ users: all(db(), "SELECT id, display_name, role, station FROM users WHERE active=1 AND role IN ('crew','lead') ORDER BY display_name"), recipes: all(db(), "SELECT id, name FROM recipes ORDER BY kind DESC, name"), signoffs: all(db(), 'SELECT t.user_id, t.recipe_id, t.at, u.display_name signer FROM training_signoffs t LEFT JOIN users u ON u.id=t.signed_by') });
  });
  app.post('/api/training/signoff', need('lead'), (req: Req, res) => {
    const { user_id, recipe_id, signed } = req.body ?? {};
    if (signed) run(db(), 'INSERT OR REPLACE INTO training_signoffs(user_id,recipe_id,signed_by) VALUES (?,?,?)', +user_id, String(recipe_id), req.user!.id);
    else run(db(), 'DELETE FROM training_signoffs WHERE user_id=? AND recipe_id=?', +user_id, String(recipe_id));
    audit(db(), actor(req), 'training.signoff', 'training_signoffs', `${user_id}:${recipe_id}`, null, { signed: !!signed });
    res.json({ ok: true });
  });

  // ── assumptions ──
  app.get('/api/assumptions', need('crew'), (_req, res) => res.json(all(db(), 'SELECT * FROM assumptions ORDER BY category, key')));
  app.put('/api/assumptions/:key', need('manager'), (req: Req, res) => {
    const before = one<{ value: number }>(db(), 'SELECT * FROM assumptions WHERE key=?', req.params.key);
    if (!before) throw httpError(404, 'Unknown assumption');
    const { value, status, basis, reason } = req.body ?? {};
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) throw httpError(400, 'value must be a non-negative number');
    if (typeof reason !== 'string' || reason.trim().length < 3) throw httpError(400, 'reason required');
    run(db(), 'UPDATE assumptions SET value=?, status=?, basis=coalesce(?,basis), updated_at=?, updated_by=? WHERE key=?', value, status === 'confirmed' ? 'confirmed' : 'assumption', typeof basis === 'string' && basis.trim() ? basis.trim().slice(0, 500) : null, new Date().toISOString(), req.user!.username, req.params.key);
    audit(db(), actor(req), 'assumption.update', 'assumptions', String(req.params.key), before, { value, status, basis }, reason);
    res.json(one(db(), 'SELECT * FROM assumptions WHERE key=?', req.params.key));
  });

  // ── history & analytics ──
  app.get('/api/history/bagels', need('crew'), (req, res) => {
    const to = isoDate(req.query.to, one<{ d: string }>(db(), "SELECT max(date) d FROM bagel_day")!.d);
    const from = isoDate(req.query.from, addDays(to, -83));
    if (dateRange(from, to).length > 800) throw httpError(400, 'Range too long');
    const days = all(db(), 'SELECT date,status,total,note FROM bagel_day WHERE date BETWEEN ? AND ? ORDER BY date', from, to);
    const flavors = all(db(), 'SELECT date,flavor,units FROM bagel_daily WHERE date BETWEEN ? AND ?', from, to);
    res.json({ from, to, days, flavors });
  });
  app.get('/api/history/sales', need('manager'), (req, res) => {
    const to = isoDate(req.query.to, one<{ d: string }>(db(), "SELECT max(date) d FROM daily_sales")!.d);
    const from = isoDate(req.query.from, addDays(to, -83));
    res.json(all(db(), 'SELECT date,net_sales,orders,guests,status FROM daily_sales WHERE date BETWEEN ? AND ? ORDER BY date', from, to));
  });
  app.get('/api/history/items', need('lead'), (req: Req, res) => {
    const money = atLeast(req.user!.role, 'manager');
    res.json(all(db(), `SELECT month, item, menu_group, sum(qty) qty${money ? ', round(sum(net),2) net' : ''}, max(partial_note) partial FROM item_monthly WHERE month >= ? GROUP BY month, item ORDER BY month, qty DESC`, typeof req.query.from === 'string' ? req.query.from : '2025-01'));
  });
  let accCache: { key: string; value: unknown } | null = null;
  app.get('/api/accuracy', need('manager'), (req, res) => {
    const to = isoDate(req.query.to, one<{ d: string }>(db(), "SELECT max(date) d FROM bagel_day WHERE status='recorded'")!.d);
    const from = isoDate(req.query.from, addDays(to, -91));
    const key = `${from}|${to}|${one<{ n: number }>(db(), 'SELECT count(*) n FROM sources')!.n}|${one<{ v: string }>(db(), "SELECT group_concat(value) v FROM assumptions WHERE category='model'")!.v}`;
    if (accCache?.key !== key) {
      const rows = walkForward(loadSeries(db()), from, to);
      accCache = { key, value: { from, to, model: MODEL_ID, scores: scoreTable(rows), byWeekday: byWeekday(rows), bias: bias(rows), rows,
        snapshots: all(db(), `SELECT s.target_date, s.made_on, s.total_point, s.total_lo, s.total_hi, d.total actual FROM forecast_snapshots s LEFT JOIN bagel_day d ON d.date=s.target_date AND d.status='recorded' ORDER BY s.target_date DESC LIMIT 60`) } };
    }
    res.json(accCache.value);
  });
  app.get('/api/sources', need('manager'), (_req, res) => res.json(all(db(), 'SELECT * FROM sources ORDER BY imported_at DESC')));

  // ── imports ──
  app.post('/api/imports/preview', need('manager'), (req, res) => {
    const { filename, content, kind } = req.body ?? {};
    if (typeof content !== 'string' || !content) throw httpError(400, 'content required');
    try { res.json(previewImport(db(), content, String(filename ?? 'upload.csv').slice(0, 120), kind as ImportKind | undefined)); } catch (e) { throw httpError(400, (e as Error).message); }
  });
  app.post('/api/imports/apply', need('manager'), (req: Req, res) => {
    const { filename, content, replace, kind } = req.body ?? {};
    if (typeof content !== 'string' || !content) throw httpError(400, 'content required');
    try { res.json(applyImport(db(), actor(req), content, String(filename ?? 'upload.csv').slice(0, 120), { replace: !!replace, kind })); } catch (e) { throw httpError(400, (e as Error).message); }
  });

  // ── people (owner) ──
  app.get('/api/users', need('owner'), (_req, res) => res.json(all(db(), 'SELECT id,username,display_name,role,lang,station,active,created_at FROM users ORDER BY active DESC, role, display_name')));
  app.post('/api/users', need('owner'), (req: Req, res) => {
    const { username, display_name, role, secret, lang, station } = req.body ?? {};
    if (!/^[a-z0-9._-]{2,30}$/i.test(username ?? '')) throw httpError(400, 'username: 2–30 letters, digits, . _ -');
    if (!['crew', 'lead', 'manager', 'owner'].includes(role)) throw httpError(400, 'Bad role');
    const err = validateSecret(role, String(secret ?? '')); if (err) throw httpError(400, err);
    if (one(db(), 'SELECT 1 FROM users WHERE username=?', username)) throw httpError(409, 'Username taken');
    const r = run(db(), 'INSERT INTO users(username,display_name,role,secret_hash,lang,station) VALUES (?,?,?,?,?,?)', username, String(display_name || username).slice(0, 60), role, hashSecret(secret), lang === 'es' ? 'es' : 'en', typeof station === 'string' ? station.slice(0, 20) : null);
    audit(db(), actor(req), 'user.create', 'users', Number(r.lastInsertRowid), null, { username, role });
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/users/:id', need('owner'), (req: Req, res) => {
    const id = +req.params.id;
    const before = one<{ role: Role; active: number }>(db(), 'SELECT id,username,display_name,role,lang,station,active FROM users WHERE id=?', id);
    if (!before) throw httpError(404, 'Not found');
    const { role, active, secret, display_name, station, lang } = req.body ?? {};
    tx(db(), () => {
      const newRole: Role = ['crew', 'lead', 'manager', 'owner'].includes(role) ? role : before.role;
      const newActive = typeof active === 'boolean' ? (active ? 1 : 0) : before.active;
      if ((before.role === 'owner' && (newRole !== 'owner' || !newActive)) && one<{ n: number }>(db(), "SELECT count(*) n FROM users WHERE role='owner' AND active=1")!.n <= 1) throw httpError(400, 'Cannot remove the last active owner');
      run(db(), 'UPDATE users SET role=?, active=?, display_name=coalesce(?,display_name), station=coalesce(?,station), lang=coalesce(?,lang) WHERE id=?', newRole, newActive, display_name ?? null, station ?? null, lang === 'es' || lang === 'en' ? lang : null, id);
      if (secret) { const err = validateSecret(newRole, String(secret)); if (err) throw httpError(400, err); run(db(), 'UPDATE users SET secret_hash=?, failed_attempts=0, locked_until=NULL WHERE id=?', hashSecret(String(secret)), id); }
      if (!newActive || secret || newRole !== before.role) run(db(), 'DELETE FROM sessions WHERE user_id=?', id);
      audit(db(), actor(req), 'user.update', 'users', id, before, { role: newRole, active: newActive, secretReset: !!secret });
    });
    res.json({ ok: true });
  });
  app.get('/api/audit', need('owner'), (req, res) => {
    const limit = Math.min(500, +(req.query.limit ?? 200) || 200);
    res.json(all(db(), 'SELECT * FROM audit_log WHERE (? IS NULL OR action LIKE ?) ORDER BY id DESC LIMIT ?', req.query.q ?? null, `%${req.query.q ?? ''}%`, limit));
  });

  // ── backups & exports ──
  app.get('/api/backups', need('owner'), (_req, res) => res.json(listBackups()));
  app.post('/api/backups', need('owner'), (req: Req, res) => {
    const name = createBackup(db(), typeof req.body?.label === 'string' ? req.body.label : 'manual');
    audit(db(), actor(req), 'backup.create', 'backup', name, null, null);
    res.json({ name });
  });
  app.get('/api/backups/:name', need('owner'), (req: Req, res) => {
    const p = backupPath(String(req.params.name));
    audit(db(), actor(req), 'backup.download', 'backup', String(req.params.name), null, null);
    res.download(p);
  });
  app.post('/api/backups/:name/restore', need('owner'), (req: Req, res) => {
    if (req.body?.confirm !== String(req.params.name)) throw httpError(400, 'Type the backup name to confirm');
    const by = actor(req);
    const r = restoreBackup(db(), String(req.params.name));
    audit(r.db, by, 'backup.restore', 'backup', String(req.params.name), null, { safetyBackup: r.safetyBackup });
    res.json({ ok: true, safetyBackup: r.safetyBackup });
  });
  app.get('/api/export/:table.csv', need('manager'), (req: Req, res) => {
    const t = String(req.params.table);
    if (!(EXPORTABLE as readonly string[]).includes(t)) throw httpError(404, 'Not exportable');
    audit(db(), actor(req), 'export.csv', t, null, null, null);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${t}.csv"`);
    res.send(toCsv(all(db(), `SELECT * FROM ${t}`)));
  });

  // ── assistant ──
  app.post('/api/ask', need('crew'), async (req: Req, res, next) => {
    try {
      const history = (Array.isArray(req.body?.history) ? req.body.history : []).filter((t: AskTurn) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string').map((t: AskTurn) => ({ role: t.role, content: t.content.slice(0, 4000) }));
      if (!history.length || history.at(-1).role !== 'user') throw httpError(400, 'Ask a question');
      const { csrf: _c, ...user } = req.user!;
      res.json(await ask(db(), user, history, businessToday()));
    } catch (e) { next(e); }
  });

  // ── B's photos (signed-in users only): assets/photos/<recipe_id>.jpg|png|webp ──
  app.get('/photos/:file', (req: Req, res, next) => {
    const t = cookie(req, COOKIE);
    if (!t || !sessionUser(db(), t)) return next(httpError(401, 'Sign in required'));
    const f = String(req.params.file);
    if (!/^[a-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(f)) return next(httpError(404, 'Not found'));
    const p = join(ROOT, 'assets', 'photos', f);
    if (!existsSync(p)) return next(httpError(404, 'Not found'));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(p);
  });

  // ── static web app ──
  const dist = join(ROOT, 'web', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(readFileSync(join(dist, 'index.html'), 'utf8')); });
  }

  app.use('/api', (_req, _res, next) => next(httpError(404, 'Not found')));
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
  });
  return app;
}

export type { DB };
