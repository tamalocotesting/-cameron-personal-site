import { createContext, useContext, type ReactNode } from 'react';

export type Lang = 'en' | 'es';
export const LangCtx = createContext<Lang>('en');
export const useLang = () => useContext(LangCtx);

/** UI strings. Spanish is our translation, pending B's review (B's build cards carry B's own Spanish). */
const S = {
  rail: ['Rail', 'Rail'], cards: ['Cards', 'Guías'], count: ['Count', 'Conteo'], shift: ['Shift', 'Turno'], ask: ['Ask', 'Preguntar'],
  bake: ['Bake', 'Hornear'], bagels: ['bagels', 'bagels'], sandwiches: ['Sandwiches', 'Sándwiches'], bacon: ['Bacon', 'Tocino'], sausage: ['Sausage', 'Salchicha'], eggs: ['Eggs', 'Huevos'],
  strips: ['strips', 'tiras'], patties: ['patties', 'medallones'], range: ['range', 'rango'], today: ['Today', 'Hoy'],
  why: ['Why this number', 'Por qué este número'], adjust: ['Adjust', 'Ajustar'], reason: ['Reason', 'Motivo'], save: ['Save', 'Guardar'], cancel: ['Cancel', 'Cancelar'],
  markDone: ['Mark done', 'Marcar hecho'], undo: ['Undo', 'Deshacer'], skip: ['Skip', 'Omitir'], signOut: ['Sign out', 'Salir'],
  previous: ['Previous shift', 'Turno anterior'], handoff: ['Handoff note', 'Nota de entrega'], waste: ['Waste', 'Merma'], checklists: ['Checklists', 'Listas'],
  pullFor: ['Freezer pull for', 'Sacar del congelador para'], creamCheese: ['Cream cheese', 'Queso crema'], inventory: ['On hand vs. needed', 'Inventario vs. necesario'],
  alerts: ['Heads up', 'Atención'], outlook: ['Next days', 'Próximos días'], noTickets: ['Nothing on the rail for this day.', 'Nada en el rail para este día.'],
} as const;
export type Key = keyof typeof S;

export function useT() {
  const lang = useLang();
  return (k: Key) => (lang === 'es' ? `${S[k][1]} · ${S[k][0]}` : S[k][0]);
}

/** Bilingual text. In Spanish mode, Spanish leads and English always sits beside it. */
export function Bi({ en, es, inline }: { en: ReactNode; es?: ReactNode | null; inline?: boolean }) {
  const lang = useLang();
  if (lang !== 'es' || !es) return <>{en}</>;
  return inline ? <>{es} <span className="faint">· {en}</span></> : <span className="bilingual"><span>{es}</span><br /><span className="faint small">{en}</span></span>;
}
export const enOf = (k: Key) => S[k][0];
export const esOf = (k: Key) => S[k][1];
export function BiKey({ k }: { k: Key }) { return <Bi en={S[k][0]} es={S[k][1]} inline />; }
