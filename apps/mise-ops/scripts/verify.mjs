/**
 * Browser verification against the built output.
 *
 * Not part of the build — it needs a local Chromium. Run it after a change
 * that could affect layout, colour or interaction:
 *
 *   npm run build:fast
 *   npx astro preview --port 4331 &
 *   node scripts/verify.mjs
 *
 * Checks, in both colour schemes where it matters:
 *   · every route returns 200, with no console errors and no failed requests
 *   · no horizontal overflow from 320px to 1728px
 *   · WCAG AA contrast on every rendered text node
 *   · every interactive target is at least 44x44 CSS px on a phone
 *   · the page is complete with JavaScript disabled
 */
import { chromium } from 'playwright';

const BASE = process.env.VERIFY_BASE || 'http://localhost:4331';
const ROUTES = [
  '/',
  '/how-it-works',
  '/sprint',
  '/care',
  '/examples',
  '/about',
  '/contact',
  '/thanks',
  '/privacy',
  '/terms',
];
const WIDTHS = [320, 360, 390, 414, 768, 1024, 1440, 1728];

const failures = [];
const note = (ok, msg) => {
  if (!ok) failures.push(msg);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`);
};

// ---- contrast helpers (run in the page) -------------------------------------
const CONTRAST_FN = `() => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const parse = (s) => {
    const n = (s.match(/[\\d.]+/g) || []).map(Number);
    // color(srgb 0.95 0.96 0.95 / 0.88) uses 0-1 channels; rgb() uses 0-255.
    if (/^color\\(/.test(s)) {
      return [n[0] * 255, n[1] * 255, n[2] * 255, ...(n.length > 3 ? [n[3]] : [])];
    }
    return n;
  };
  const over = (fg, bg) => {
    const a = fg[3] === undefined ? 1 : fg[3];
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
  };
  const bgOf = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement.parentNode) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0)) {
        acc = acc ? over(acc, c) : c;
        if (c[3] === undefined || c[3] >= 1) return acc.slice(0, 3);
      }
      node = node.parentElement;
    }
    return (acc || [255, 255, 255]).slice(0, 3);
  };
  const out = [];
  document.querySelectorAll('*').forEach((el) => {
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (!text) return;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fg = over(parse(st.color), bgOf(el));
    const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(st.fontSize);
    const bold = Number(st.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      out.push({ tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 40), text: text.slice(0, 40), ratio: +ratio.toFixed(2), need });
    }
  });
  return out;
}`;

// This environment ships a pinned Chromium that may not match the version the
// installed Playwright expects, so point at it explicitly rather than letting
// Playwright look for its own download.
const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const failed = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => failed.push(r.url()));

  for (const route of ROUTES) {
    const res = await page.goto(BASE + route, { waitUntil: 'networkidle' });
    note(res?.status() === 200, `${scheme} ${route} → ${res?.status()}`);
    // CONTRAST_FN is source text, so it must be invoked rather than returned.
    const bad = await page.evaluate(`(${CONTRAST_FN})()`);
    note(bad.length === 0, `${scheme} ${route} contrast: ${bad.length} failing node(s)`);
    bad.slice(0, 8).forEach((b) => console.log(`         ${b.tag}.${b.cls} "${b.text}" ${b.ratio}:1 (need ${b.need})`));
  }

  note(errors.length === 0, `${scheme} console errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log('         ' + e));
  note(failed.length === 0, `${scheme} failed requests: ${failed.length}`);
  failed.slice(0, 5).forEach((f) => console.log('         ' + f));
  await ctx.close();
}

// ---- responsive ------------------------------------------------------------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      note(overflow <= 0, `${route} @ ${width}px — horizontal overflow ${overflow}px`);
    }
  }
  await ctx.close();
}

// ---- tap targets on a phone -------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const small = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a, button, summary, input, label[for]').forEach((el) => {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      // Visually-hidden controls (a radio behind its own label) are not the
      // tap target; the label that references them is, and it is checked too.
      if (el.closest('.sr-only') || st.clipPath === 'inset(50%)') return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.width < 44 || r.height < 44) {
        out.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    });
    return out;
  });
  note(small.length === 0, `tap targets under 44x44 at 390px: ${small.length}`);
  small.slice(0, 10).forEach((s) => console.log(`         <${s.tag}> "${s.text}" ${s.w}x${s.h}`));
  await ctx.close();
}

// ---- the walkthrough form ---------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/contact', { waitUntil: 'networkidle' });

  // Netlify needs these three things present in the built HTML to register
  // the form at deploy time. If any goes missing, submissions silently vanish.
  const wiring = await page.evaluate(() => {
    const form = document.querySelector('form[data-netlify]');
    return {
      hasForm: !!form,
      name: form?.getAttribute('name') ?? null,
      hiddenName: form?.querySelector('input[name="form-name"]')?.value ?? null,
      honeypot: form?.getAttribute('netlify-honeypot') ?? null,
      action: form?.getAttribute('action') ?? null,
    };
  });
  note(wiring.hasForm, 'form: data-netlify present');
  note(
    wiring.name !== null && wiring.name === wiring.hiddenName,
    `form: name "${wiring.name}" matches hidden form-name "${wiring.hiddenName}"`
  );
  note(!!wiring.honeypot, `form: honeypot declared (${wiring.honeypot})`);
  note(wiring.action === '/thanks', `form: no-JS action is ${wiring.action}`);

  // The honeypot must be off-screen, not display:none, and never required.
  const trap = await page.evaluate((field) => {
    const el = document.querySelector(`input[name="${field}"]`);
    if (!el) return null;
    const st = getComputedStyle(el);
    return { required: el.required, display: st.display, tabIndex: el.tabIndex };
  }, wiring.honeypot ?? '');
  note(trap !== null && !trap.required && trap.display !== 'none' && trap.tabIndex === -1,
    'form: honeypot is off-screen, optional and not tabbable');

  // Submitting empty must be stopped by the browser, not by us.
  await page.click('[data-lead-submit]');
  note(
    await page.locator('[data-lead-success]').isHidden(),
    'form: empty submit blocked by native validation'
  );

  // Fill it, stub the network, and check the success panel takes over.
  await page.route('**/*', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 200, body: 'ok' })
      : route.continue()
  );
  await page.fill('#f-first-name', 'Sam');
  await page.fill('#f-last-name', 'Rivera');
  await page.fill('#f-restaurant', 'Birch & Board');
  await page.fill('#f-email', 'sam@example.com');
  await page.fill('#f-phone', '3175550123');
  await page.fill('#f-city', 'Carmel');
  await page.selectOption('#f-locations', '1');
  await page.selectOption('#f-employees', '11–25');
  await page.click('input[name="opening-another"][value="Yes"] + .chip__face');
  await page.fill('#f-frustration', 'Same questions every single shift.');
  await page.click('input[name="contact-preference"][value="Email"] + .chip__face');
  await page.click('[data-lead-submit]');
  await page.waitForTimeout(600);

  note(await page.locator('[data-lead-success]').isVisible(), 'form: success panel shown after submit');
  note(await page.locator('form[data-netlify]').isHidden(), 'form: form hidden after submit');
  await ctx.close();
}

// ---- the calculator ---------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/how-it-works', { waitUntil: 'networkidle' });

  const before = await page.locator('[data-out="annualCost"]').textContent();
  await page.fill('#c-questionsPerShift', '30');
  await page.dispatchEvent('#c-questionsPerShift', 'input');
  await page.waitForTimeout(150);
  const after = await page.locator('[data-out="annualCost"]').textContent();
  note(before !== after, `calculator: recomputes on input (${before?.trim()} → ${after?.trim()})`);

  // An emptied box must fall back to the default, never render NaN.
  await page.fill('#c-managerRate', '');
  await page.dispatchEvent('#c-managerRate', 'input');
  await page.waitForTimeout(150);
  const nan = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-out]')).some((el) =>
      (el.textContent || '').includes('NaN')
    )
  );
  note(!nan, 'calculator: no NaN when an input is emptied');
  await ctx.close();
}

// ---- no-JS -----------------------------------------------------------------
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  const stats = await page.evaluate(() => ({
    text: document.body.innerText.trim().length,
    sections: document.querySelectorAll('section').length,
    hidden: Array.from(document.querySelectorAll('[data-reveal]')).filter(
      (el) => getComputedStyle(el).opacity === '0'
    ).length,
  }));
  note(stats.text > 4000, `no-JS: ${stats.text} chars of text rendered`);
  note(stats.sections >= 10, `no-JS: ${stats.sections} sections present`);
  note(stats.hidden === 0, `no-JS: ${stats.hidden} reveal elements stuck invisible`);
  await ctx.close();
}

await browser.close();

console.log('');
if (failures.length) {
  console.error(`verify: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('verify: all checks passed');
