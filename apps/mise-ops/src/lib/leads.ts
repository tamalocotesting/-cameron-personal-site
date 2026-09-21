/**
 * Lead submission — the seam between the forms and wherever leads actually go.
 *
 * Every form on the site submits through `submitLead()`. Today that encodes
 * the payload for Netlify Forms. Moving to a CRM, a scheduler or a webhook
 * means changing `submitLead()` and `src/config/forms.ts`; no form component,
 * no page and no field definition has to change.
 *
 * Progressive enhancement matters here: the form element is a real POST to
 * Netlify with the right hidden fields, so if this module never runs — script
 * blocked, JS error, slow network — the submission still works natively and
 * the visitor lands on Netlify's own success page.
 */
import { forms } from '../config/forms';

export interface LeadFieldDef {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'select' | 'textarea' | 'radio' | 'number';
  required?: boolean;
  autocomplete?: string;
  options?: readonly string[];
  placeholder?: string;
  /** Rendered under the field. */
  help?: string;
  /** Layout hint: does the field take half a row on wide screens? */
  half?: boolean;
}

/**
 * The Operations Walkthrough request. This array is the single definition of
 * the form: it renders the fields, and it is what a future CRM mapping would
 * be written against.
 */
export const walkthroughFields: readonly LeadFieldDef[] = [
  { name: 'first-name', label: 'First name', type: 'text', required: true, autocomplete: 'given-name', half: true },
  { name: 'last-name', label: 'Last name', type: 'text', required: true, autocomplete: 'family-name', half: true },
  { name: 'restaurant', label: 'Restaurant name', type: 'text', required: true, autocomplete: 'organization' },
  { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email', half: true },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel', half: true },
  { name: 'city', label: 'City', type: 'text', required: true, autocomplete: 'address-level2', half: true },
  {
    name: 'locations',
    label: 'Number of locations',
    type: 'select',
    required: true,
    half: true,
    options: ['1', '2', '3–5', '6+'],
  },
  {
    name: 'employees',
    label: 'Approximate employees',
    type: 'select',
    required: true,
    half: true,
    options: ['1–10', '11–25', '26–50', '51–100', '100+'],
  },
  {
    name: 'opening-another',
    label: 'Opening another location in the next year?',
    type: 'radio',
    required: true,
    half: true,
    options: ['Yes', 'No', 'Not sure'],
  },
  {
    name: 'frustration',
    label: 'Biggest operational frustration right now',
    type: 'textarea',
    required: true,
    placeholder: 'The thing that keeps coming back to you — the question you answer every week.',
  },
  {
    name: 'contact-preference',
    label: 'Preferred contact method',
    type: 'radio',
    required: true,
    options: ['Email', 'Phone', 'Text'],
  },
  { name: 'notes', label: 'Anything else', type: 'textarea', help: 'Optional.' },
] as const;

export interface LeadResult {
  ok: boolean;
  /** Present when ok is false. Safe to show a visitor. */
  error?: string;
}

/** Netlify reads a urlencoded body with `form-name` naming the form. */
function encodeNetlify(data: FormData, formName: string): string {
  const params = new URLSearchParams();
  params.append('form-name', formName);
  for (const [key, value] of data.entries()) {
    if (key === 'form-name') continue;
    if (typeof value === 'string') params.append(key, value);
  }
  return params.toString();
}

export async function submitLead(data: FormData): Promise<LeadResult> {
  // A filled honeypot is a bot. Report success so it learns nothing, and send
  // nothing onward.
  const trap = data.get(forms.honeypot);
  if (typeof trap === 'string' && trap.trim() !== '') return { ok: true };

  try {
    if (forms.provider === 'netlify') {
      const response = await fetch(forms.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encodeNetlify(data, forms.formName),
      });
      if (!response.ok) throw new Error(`Submission failed (${response.status})`);
      return { ok: true };
    }

    // provider === 'endpoint' — a JSON API, whenever one exists.
    const response = await fetch(forms.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(data.entries())),
    });
    if (!response.ok) throw new Error(`Submission failed (${response.status})`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? 'That didn’t send. Please try again, or email us directly.'
          : 'That didn’t send. Please try again, or email us directly.',
    };
  }
}
