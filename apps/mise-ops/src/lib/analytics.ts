/**
 * Analytics — the event vocabulary, and one function that emits it.
 *
 * Deliberately not a vendor SDK. Nothing third-party is loaded, no cookie is
 * set, and no identifier is stored, so the site needs no consent banner and
 * carries no tracking weight. `track()` emits a DOM CustomEvent and forwards
 * to a privacy-preserving counter (Plausible or Umami) *if* one has been added
 * to the page; if neither is present it is a no-op costing one property read.
 *
 * To turn collection on later, add that provider's script tag in Base.astro.
 * Nothing else in the codebase changes.
 */

/** Every event the site emits. Adding one here is how it gets named. */
export const EVENTS = {
  ctaClick: 'cta_click',
  walkthroughStart: 'walkthrough_form_start',
  walkthroughSubmit: 'walkthrough_form_submit',
  walkthroughError: 'walkthrough_form_error',
  beforeAfterInteract: 'before_after_interact',
  calculatorUse: 'calculator_use',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type EventProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    plausible?: (event: string, opts?: { props?: EventProps }) => void;
    umami?: { track: (event: string, props?: EventProps) => void };
  }
}

export function track(event: EventName, props: EventProps = {}): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('miseops:track', { detail: { event, props } }));

  try {
    window.plausible?.(event, { props });
    window.umami?.track(event, props);
  } catch {
    // Analytics must never break the page it is measuring.
  }
}

/**
 * Wires every `[data-track]` element on the page to `track()`, so a CTA is
 * instrumented by adding an attribute in markup rather than a listener in
 * script. `data-track-props` is an optional JSON object.
 */
export function bindTrackedElements(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-track]').forEach((el) => {
    el.addEventListener('click', () => {
      const name = el.dataset.track as EventName | undefined;
      if (!name) return;
      let props: EventProps = {};
      if (el.dataset.trackProps) {
        try {
          props = JSON.parse(el.dataset.trackProps) as EventProps;
        } catch {
          // A malformed attribute loses its properties, not the event.
        }
      }
      track(name, props);
    });
  });
}
