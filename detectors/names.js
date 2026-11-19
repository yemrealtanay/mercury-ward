// detectors/names.js — isim listesi + regex ile isim soyisim tespiti.
// Sözleşme: detect(text, ignore) -> Promise<[{ name, context, count }]>
// LLM devreye girdiğinde aynı imzayla detectors/llm.js yazılır, server.js'te import değişir.
import fs from 'node:fs';

// İkinci kelime bunlardan biriyse bulgu sayılmaz (adres, şirket ve sık geçen kelimeler).
const NOT_SURNAME = new Set([
  // adres ekleri
  'road', 'rd', 'street', 'st', 'avenue', 'ave', 'lane', 'close', 'way', 'drive', 'court', 'house',
  'park', 'place', 'gardens', 'garden', 'square', 'hill', 'grove', 'crescent', 'terrace', 'mews',
  'row', 'walk', 'rise', 'view', 'vale', 'green', 'wharf', 'quay', 'yard', 'parade', 'gate', 'mount',
  'wood', 'woods', 'field', 'fields', 'meadow', 'meadows', 'common', 'end', 'bank', 'cottage',
  'cottages', 'villas', 'mansions', 'buildings', 'chase', 'approach', 'circus', 'heights', 'estate',
  'boulevard', 'bridge', 'station', 'line', 'hall', 'manor', 'lodge', 'farm', 'mill',
  'point', 'tower', 'towers', 'centre', 'center', 'passage', 'path', 'hospital', 'school',
  'college', 'church', 'chapel', 'abbey', 'market', 'cross', 'island', 'valley', 'forest', 'hospice',
  // şirket / sektör
  'ltd', 'limited', 'plc', 'llp', 'estates', 'agents', 'agency', 'lettings', 'letting', 'sales',
  'homes', 'property', 'properties', 'group', 'partners', 'associates', 'team', 'residential',
  'surveyors', 'mortgages', 'financial', 'solicitors', 'law', 'trust', 'foundation',
  // sık geçen kelimeler
  'the', 'and', 'or', 'of', 'our', 'your', 'you', 'we', 'for', 'to', 'in', 'on', 'at', 'with', 'from',
  'by', 'is', 'are', 'has', 'have', 'this', 'that', 'it', 'its', 'my', 'all', 'more', 'read', 'view',
  'contact', 'call', 'email', 'about', 'news', 'blog', 'home', 'search', 'book', 'menu',
]);

const LETTER = "\\p{L}\\p{M}'’\\-";
// İkinci kelime lookahead içinde: "Contact John Smith" metninde "John Smith" kaçmaz.
const NAME_RE = new RegExp(
  `(?<![${LETTER}])(\\p{Lu}\\p{Ll}+)\\s+(?=(\\p{Lu}[${LETTER}]+)(?![${LETTER}]))`,
  'gu',
);
const CONTEXT = 40;

const FIRST_NAMES = new Set(
  fs.readFileSync(new URL('../data/first_names.txt', import.meta.url), 'utf8')
    .split('\n').map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith('#')),
);

export async function detect(text, ignore = new Set()) {
  const found = new Map();
  let prevLastAt = -1; // önceki bulgunun soyadının başladığı yer
  for (const m of text.matchAll(NAME_RE)) {
    const first = m[1];
    // "Rachel Riley Neil King" listesinde "Riley Neil" ayrıca sayılmaz.
    if (m.index === prevLastAt) continue;
    const last = m[2].replace(/['’]s$/, '').replace(/['’\-]+$/, '');
    if (last.length < 2) continue;
    if (!FIRST_NAMES.has(first.toLowerCase())) continue;
    if (NOT_SURNAME.has(last.toLowerCase())) continue;
    const name = `${first} ${last}`;
    const key = name.toLowerCase();
    prevLastAt = m.index + m[0].length;
    if (ignore.has(key)) continue;
    const prev = found.get(key);
    if (prev) {
      prev.count++;
      continue;
    }
    const end = m.index + m[0].length + m[2].length;
    const context = text.slice(Math.max(0, m.index - CONTEXT), end + CONTEXT).trim();
    found.set(key, { name, context, count: 1 });
  }
  return [...found.values()];
}
