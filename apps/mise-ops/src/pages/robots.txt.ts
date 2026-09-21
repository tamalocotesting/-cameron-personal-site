/**
 * robots.txt as a route rather than a static file, so a deploy preview can say
 * "do not index" while production says the opposite. A committed public file
 * could only ever say one of those things.
 */
import type { APIRoute } from 'astro';
import { isProductionDeploy } from '../../site.config.mjs';

export const GET: APIRoute = ({ site }) => {
  const body = isProductionDeploy()
    ? ['User-agent: *', 'Allow: /', '', `Sitemap: ${new URL('sitemap-index.xml', site).href}`, ''].join('\n')
    : ['# Non-production deploy — not for indexing.', 'User-agent: *', 'Disallow: /', ''].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
