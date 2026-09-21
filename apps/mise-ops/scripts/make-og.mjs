/**
 * Renders the social card and the PNG icons, using the site's own typeface.
 *
 * Needs a local Chromium, so it is a deliberate manual step rather than part
 * of the build — Netlify never runs it:
 *
 *   npm install --no-save playwright
 *   node scripts/make-og.mjs
 *
 * Copy is read out of src/config/brand.ts rather than repeated here, so the
 * card cannot drift from the site. If that file's shape changes this throws
 * rather than quietly rendering something stale.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

const brandSrc = readFileSync(join(root, 'src/config/brand.ts'), 'utf8');
const field = (name) => {
  const m = brandSrc.match(new RegExp(`${name}:\\s*(['"\`])([\\s\\S]*?)\\1`));
  if (!m) throw new Error(`make-og: could not read "${name}" from src/config/brand.ts`);
  return m[2].replace(/\s+/g, ' ').trim();
};

const name = field('name');
const tagline = field('tagline');
const headline = 'Your restaurant shouldn’t live in your head.';

const fontData = readFileSync(join(pub, 'fonts/schibsted-grotesk-var-latin.woff2')).toString('base64');
const monoData = readFileSync(join(pub, 'fonts/jetbrains-mono-var-latin.woff2')).toString('base64');

const shell = (body, css) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'S';src:url(data:font/woff2;base64,${fontData}) format('woff2');font-weight:400 900}
@font-face{font-family:'M';src:url(data:font/woff2;base64,${monoData}) format('woff2');font-weight:100 800}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'S',sans-serif;-webkit-font-smoothing:antialiased}
${css}</style></head><body>${body}</body></html>`;

const OG = shell(
  `<div class="card">
     <div class="top">
       <div class="mark">
         <span class="sq sq--o"></span><span class="sq sq--f"></span>
         <span class="sq sq--o"></span><span class="sq sq--o"></span>
       </div>
       <span class="word">MISE <b>OPS</b></span>
     </div>
     <h1>${headline}</h1>
     <div class="bottom">
       <span class="tag">${tagline}</span>
       <span class="rule"></span>
     </div>
   </div>`,
  `.card{width:1200px;height:630px;background:#101413;color:#eef1ef;padding:72px 80px;
     display:flex;flex-direction:column;justify-content:space-between;
     background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.028) 0 1px,transparent 1px 4px)}
   .top{display:flex;align-items:center;gap:16px}
   .mark{display:grid;grid-template-columns:repeat(2,18px);grid-auto-rows:18px;gap:5px}
   .sq{display:block;width:18px;height:18px;border-radius:3px}
   .sq--o{border:3px solid #eef1ef}
   .sq--f{background:#3fbc86}
   .word{font-size:34px;font-weight:800;letter-spacing:.09em}
   .word b{color:#3fbc86}
   h1{font-size:88px;line-height:1.02;font-weight:800;letter-spacing:-.035em;
      text-transform:uppercase;max-width:15ch}
   .bottom{display:flex;flex-direction:column;gap:22px}
   .rule{height:8px;width:180px;background:#3fbc86;border-radius:2px}
   .tag{font-family:'M',monospace;font-size:24px;letter-spacing:.02em;color:#b7bfbb}`
);

const icon = (px) =>
  shell(
    `<div class="i"><span class="sq sq--o"></span><span class="sq sq--f"></span>
     <span class="sq sq--o"></span><span class="sq sq--o"></span></div>`,
    `body{width:${px}px;height:${px}px}
     .i{width:${px}px;height:${px}px;background:#121614;border-radius:${px * 0.19}px;
        display:grid;grid-template-columns:repeat(2,1fr);gap:${px * 0.055}px;
        padding:${px * 0.2}px;align-content:center}
     .sq{border-radius:${px * 0.035}px}
     .sq--o{border:${Math.max(2, px * 0.045)}px solid #f3f5f4}
     .sq--f{background:#0e8a5c}`
  );

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});

const shoot = async (html, width, height, out) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  writeFileSync(join(pub, out), buf);
  console.log(`  ${out}  ${width}x${height}`);
  await page.close();
};

await shoot(OG, 1200, 630, 'og.png');
await shoot(icon(180), 180, 180, 'apple-touch-icon.png');
await shoot(icon(192), 192, 192, 'icon-192.png');
await shoot(icon(512), 512, 512, 'icon-512.png');

await browser.close();
console.log('make-og: done');
