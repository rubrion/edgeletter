/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
};

/** Pull (email, lang) pairs from parsed CSV: header row optional, email column auto-detected. */
export const extractContacts = (rows: string[][]): { email: string; lang: 'en' | 'pt' }[] => {
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => h === 'email' || h === 'e-mail');
  const emailCol = hasHeader ? header.findIndex((h) => h === 'email' || h === 'e-mail') : rows[0]!.findIndex((f) => f.includes('@'));
  const langCol = hasHeader ? header.findIndex((h) => h === 'lang' || h === 'language') : -1;
  if (emailCol < 0) return [];
  return (hasHeader ? rows.slice(1) : rows).map((r) => ({
    email: (r[emailCol] ?? '').trim().toLowerCase(),
    lang: /^pt/i.test((langCol >= 0 ? r[langCol] : '') ?? '') ? 'pt' : 'en',
  }));
};
