/**
 * The markets MISE OPS serves.
 *
 * Two jobs, deliberately separated:
 *
 *  1. EVERY entry is listed in `areaServed` on the organisation schema and in
 *     the footer. That is a true statement about where the business works, and
 *     it costs nothing.
 *
 *  2. Only an entry with `publish: true` gets its own /restaurant-operations/<slug>
 *     page. The route exists and generates from this data, but a location page
 *     that just swaps a city name into the same paragraph is a doorway page:
 *     it is thin, it reads as spam to an owner, and Google has been
 *     demoting it for years.
 *
 * So the bar for `publish: true` is a real `angle` and real `detail` — a
 * reason this city's page is worth reading that is not true of the others.
 * Until someone can write that, the city stays unpublished and still appears
 * in areaServed. Nothing here may be invented: no client names, no counts,
 * no results.
 */

export interface ServiceArea {
  slug: string;
  city: string;
  county: string;
  /** Always true — used for schema and the footer list. */
  areaServed: true;
  /** Gate for the location page. False until the content below is real. */
  publish: boolean;
  /** The one thing that makes this market's page different. */
  angle?: string;
  /** Supporting paragraphs. Written from knowledge of the market, not filler. */
  detail?: string[];
}

export const serviceAreas: readonly ServiceArea[] = [
  { slug: 'carmel', city: 'Carmel', county: 'Hamilton County', areaServed: true, publish: false },
  { slug: 'westfield', city: 'Westfield', county: 'Hamilton County', areaServed: true, publish: false },
  { slug: 'fishers', city: 'Fishers', county: 'Hamilton County', areaServed: true, publish: false },
  { slug: 'indianapolis', city: 'Indianapolis', county: 'Marion County', areaServed: true, publish: false },
  { slug: 'noblesville', city: 'Noblesville', county: 'Hamilton County', areaServed: true, publish: false },
  { slug: 'zionsville', city: 'Zionsville', county: 'Boone County', areaServed: true, publish: false },
] as const;

/** Every market, for schema and the footer. */
export const allAreas = serviceAreas;

/** Only the markets with a page worth publishing. Drives getStaticPaths. */
export const publishedAreas = serviceAreas.filter((a) => a.publish);

/** "Carmel, Westfield, Fishers, Noblesville, Zionsville and Indianapolis" */
export const areaSentence = (() => {
  const names = serviceAreas.map((a) => a.city);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
})();
