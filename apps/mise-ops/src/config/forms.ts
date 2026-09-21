/**
 * Lead capture configuration.
 *
 * Phase 1 is Netlify Forms: no backend, no database, no API keys. The point of
 * routing every submission through `src/lib/leads.ts` is that moving to a CRM,
 * a scheduler, an email automation or a webhook later is a change to that one
 * module and this one object — not a rewrite of every form on the site.
 */

export type LeadProvider = 'netlify' | 'endpoint';

export interface FormsConfig {
  provider: LeadProvider;
  /** Netlify Forms identifier. Must match the `name` on the rendered form. */
  formName: string;
  /**
   * Where a submission is POSTed. Netlify captures a form posted to any path
   * on the site; '/' keeps it independent of which page the form is on.
   * Switch `provider` to 'endpoint' and this becomes the API URL.
   */
  action: string;
  /** Hidden field name used to catch bots. Never shown, never required. */
  honeypot: string;
}

export const forms: FormsConfig = {
  provider: 'netlify',
  formName: 'operations-walkthrough',
  action: '/',
  honeypot: 'company-website',
};
