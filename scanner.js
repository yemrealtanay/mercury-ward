// scanner.js — domain temizleme, sitemap okuma, güvenli sayfa indirme, HTML'den düz metin
import dns from 'node:dns/promises';
import zlib from 'node:zlib';
import ipaddr from 'ipaddr.js';
import * as cheerio from 'cheerio';

const UA = 'MercuryWard/0.1 (+privacy awareness scanner)';
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SITEMAP_DEPTH = 2;
export const MAX_URLS = Number(process.env.MAX_URLS || 500);

// "https://www.Site.co.uk/path:8080" -> "www.site.co.uk". IP adresi ve tek kelimelik host kabul edilmez.
export function cleanDomain(input) {
  const s = String(input || '').trim().toLowerCase();
  let host;
  try {
    host = new URL(s.includes('://') ? s : `https://${s}`).hostname;
  } catch {
    throw new Error('Invalid domain');
  }
  host = host.replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || ipaddr.IPv4.isValidFourPartDecimal(host)) {
    throw new Error('Invalid domain');
  }
  return host;
}

// "www.site.co.uk" ile "site.co.uk" ve alt domain'leri aynı site sayılır.
export function sameSite(host, domain) {
  const strip = (h) => h.toLowerCase().replace(/^www\./, '');
  const h = strip(host);
  const d = strip(domain);
  return h === d || h.endsWith(`.${d}`);
}

// SSRF koruması: localhost, iç ağ ve özel IP'lere istek atılmaz.
export async function assertPublicHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  const addrs = ipaddr.isValid(bare)
    ? [{ address: bare }]
    : await dns.lookup(bare, { all: true });
  for (const { address } of addrs) {
    if (ipaddr.process(address).range() !== 'unicast') {
      throw new Error(`Blocked address: ${hostname} -> ${address}`);
    }
  }
}

// Yönlendirmeleri elle takip eder; her adımda protokol, port, site ve IP yeniden kontrol edilir.
async function safeFetch(url, domain) {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'https:' && current.protocol !== 'http:') {
      throw new Error(`Unsupported protocol: ${current.href}`);
    }
    if (current.port && current.port !== '80' && current.port !== '443') {
      throw new Error(`Unsupported port: ${current.href}`);
    }
    if (!sameSite(current.hostname, domain)) throw new Error(`Off-site URL: ${current.href}`);
    await assertPublicHost(current.hostname);

    const res = await fetch(current, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current);
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects: ${url}`);
}

async function readBody(res) {
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('Response too large');
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  // .xml.gz sitemap'ler
  return buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}

async function fetchText(url, domain) {
  const res = await safeFetch(url, domain);
  if (res.status !== 200) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  return { text: await readBody(res), type: res.headers.get('content-type') || '' };
}

export function parseSitemap(xml) {
  const $ = cheerio.load(xml, { xml: true });
  const locs = $('loc').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  return { isIndex: $('sitemapindex').length > 0, locs };
}

async function collect(sitemapUrl, domain, depth, out) {
  const { text } = await fetchText(sitemapUrl, domain);
  const { isIndex, locs } = parseSitemap(text);
  if (!isIndex) {
    for (const loc of locs) {
      if (out.size >= MAX_URLS) break;
      try {
        const u = new URL(loc);
        u.hash = '';
        if (sameSite(u.hostname, domain)) out.add(u.href);
      } catch { /* bozuk URL atlanır */ }
    }
    return;
  }
  if (depth >= MAX_SITEMAP_DEPTH) return;
  for (const child of locs) {
    if (out.size >= MAX_URLS) break;
    try {
      await collect(child, domain, depth + 1, out);
    } catch (e) {
      console.warn(`Child sitemap skipped: ${child}: ${e.message}`);
    }
  }
}

async function robotsSitemaps(domain) {
  try {
    const { text } = await fetchText(`https://${domain}/robots.txt`, domain);
    return [...text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  } catch {
    return [];
  }
}

// Sitemap'ten taranacak sayfa URL'lerini döndürür (en fazla MAX_URLS).
// Sırayla: /sitemap.xml, robots.txt'deki Sitemap: satırları, /sitemap_index.xml.
export async function findPageUrls(domain) {
  const tried = new Set();
  let lastError = null;
  const candidates = [`https://${domain}/sitemap.xml`];
  let robotsChecked = false;
  while (candidates.length || !robotsChecked) {
    if (!candidates.length) {
      robotsChecked = true;
      candidates.push(...(await robotsSitemaps(domain)), `https://${domain}/sitemap_index.xml`);
      continue;
    }
    const url = candidates.shift();
    if (tried.has(url)) continue;
    tried.add(url);
    const out = new Set();
    try {
      await collect(url, domain, 0, out);
    } catch (e) {
      lastError = e;
    }
    if (out.size) return [...out];
  }
  throw new Error(`No usable sitemap found${lastError ? ` (${lastError.message})` : ''}`);
}

export function htmlToText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, svg').remove();
  $('body *').each((_, el) => { $(el).append(' '); }); // etiketler arası boşluk
  return $('body').text().replace(/\s+/g, ' ').trim();
}

// Sayfanın düz metni; 200 dönmeyen ya da HTML olmayan sayfalar için null.
export async function pageText(url, domain) {
  const res = await safeFetch(url, domain);
  const type = res.headers.get('content-type') || '';
  if (res.status !== 200 || !/text\/html|application\/xhtml/i.test(type)) {
    await res.body?.cancel();
    return null;
  }
  return htmlToText(await readBody(res));
}
