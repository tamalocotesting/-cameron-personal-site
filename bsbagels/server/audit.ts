import type { DB } from './db.ts';
import { run } from './db.ts';

export interface Actor { id: number | null; username: string }
export const SYSTEM: Actor = { id: null, username: 'system' };

/** Append-only audit trail. Every state-changing route calls this inside its transaction. */
export function audit(db: DB, actor: Actor, action: string, entity: string | null, entityId: string | number | null, before: unknown, after: unknown, reason?: string) {
  run(db, 'INSERT INTO audit_log(user_id,username,action,entity,entity_id,before_json,after_json,reason) VALUES (?,?,?,?,?,?,?,?)',
    actor.id, actor.username, action, entity, entityId === null ? null : String(entityId),
    before === undefined || before === null ? null : JSON.stringify(before),
    after === undefined || after === null ? null : JSON.stringify(after), reason ?? null);
}
