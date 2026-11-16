// Shared Tactile Editorial Stationery styling for transactional emails.
// Email clients ignore clip-path, CSS vars and most web fonts, so this is a
// table-safe approximation: parchment background, ivory card, solid
// terracotta band with tone-on-tone (debossed) lettering, Georgia fallbacks.

export const EMAIL = {
  paper: '#E7E4DE',
  card: '#F5F3EE',
  ink: '#2A231D',
  text: '#3A3129',
  muted: '#7A6E62',
  hairline: '#D8D3CA',
  display: "'Instrument Serif', 'Cormorant Garamond', Georgia, 'Times New Roman', serif",
  body: "'Newsreader', Georgia, 'Times New Roman', serif",
  fontsLink:
    '<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Newsreader:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">',
} as const;

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Mix a hex color toward black — the debossed tone used on terracotta. */
export const deepen = (hex: string, keep = 0.45): string => {
  const m = hex.trim().replace(/^#/, '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#6B230D';
  const n = parseInt(full, 16);
  const r = clamp(((n >> 16) & 0xff) * keep);
  const g = clamp(((n >> 8) & 0xff) * keep);
  const b = clamp((n & 0xff) * keep);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

/** Uppercase, widely tracked serif micro-copy. */
export const microStyle = (color: string) =>
  `font-family:${EMAIL.body};font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:${color};`;
