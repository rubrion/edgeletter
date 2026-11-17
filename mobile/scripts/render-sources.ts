/**
 * Renders the app's source artwork from the brand mark (public/logo.svg):
 * mobile/assets/* for `bun run assets` (@capacitor/assets) and the Play
 * listing images in mobile/store/. Run from the repo root:
 *   bun mobile/scripts/render-sources.ts
 * Uses the root project's sharp.
 */
import sharp from 'sharp';

const RUST = '#B44A27';
const CREAM = '#F5F3EE';
const PAPER = '#E7E4DE';
const INK = '#2A231D';

const mark = (stroke: string) =>
  `<g fill="none" stroke="${stroke}" stroke-width="4" stroke-linejoin="miter" stroke-linecap="butt"><path d="M20 34V12H44V34"/><path d="M26 20H38"/><path d="M12 28L32 42L52 28V52H12Z"/></g>`;

const svg = (viewBox: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
const icon = svg('0 0 64 64', `<rect width="64" height="64" fill="${RUST}"/>${mark(CREAM)}`);

const png = (input: string, size: number, out: string, density = 2400) =>
  sharp(Buffer.from(input), { density }).resize(size, size).png().toFile(out);

const splash = async (bg: string, out: string) => {
  const logo = await sharp(Buffer.from(icon), { density: 1200 }).resize(520, 520).png().toBuffer();
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: bg } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(out);
};

const A = 'mobile/assets';
await png(icon, 1024, `${A}/icon-only.png`);
// Adaptive icon: the mark alone (a little smaller, so the launcher's circle
// mask never clips the envelope's corners) over a flat rust background.
await png(svg('-6 -6 76 76', mark(CREAM)), 1024, `${A}/icon-foreground.png`);
await png(svg('0 0 64 64', `<rect width="64" height="64" fill="${RUST}"/>`), 1024, `${A}/icon-background.png`);
await splash(PAPER, `${A}/splash.png`);
await splash(INK, `${A}/splash-dark.png`);

const S = 'mobile/store';
await png(icon, 512, `${S}/icon-512.png`);
const feature = svg(
  '0 0 1024 500',
  `<rect width="1024" height="500" fill="${RUST}"/>
   <g transform="translate(96 130) scale(3.75)">${mark(CREAM)}</g>
   <text x="380" y="255" fill="${CREAM}" font-family="Liberation Serif, Georgia, serif" font-size="96">EdgeLetter</text>
   <text x="384" y="318" fill="${CREAM}" fill-opacity="0.85" font-family="Liberation Serif, Georgia, serif" font-style="italic" font-size="34">Write, publish and send your newsletter.</text>`,
);
await sharp(Buffer.from(feature), { density: 144 }).resize(1024, 500).png().toFile(`${S}/feature-1024x500.png`);
console.log('rendered mobile/assets and mobile/store images');
