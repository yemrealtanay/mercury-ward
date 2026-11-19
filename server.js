// server.js — form, kayıt ve tarama kuyruğu
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { cleanDomain, findPageUrls, pageText } from './scanner.js';
import { detect } from './detectors/names.js';
import { sendReport, sendFailure, mailTransport } from './mailer.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DB_PATH = process.env.DB_PATH
  || (volume ? path.join(volume, 'mercuryward.db') : path.join(ROOT, 'data', 'mercuryward.db'));
const DELAY_MS = process.env.REQUEST_DELAY_MS ? Number(process.env.REQUEST_DELAY_MS) : 1000;
const MAX_QUEUE = Number(process.env.MAX_QUEUE || 20);
const SCAN_CONCURRENCY = Math.max(1, Number(process.env.SCAN_CONCURRENCY || 3));
const ONE_SCAN_PER_SITE = process.env.ONE_SCAN_PER_SITE === 'true';
// 0 = sınır yok (test için). Varsayılan: IP ve e-posta başına saatte 5 tarama.
const RATE_LIMIT_PER_HOUR = process.env.RATE_LIMIT_PER_HOUR ? Number(process.env.RATE_LIMIT_PER_HOUR) : 5;

// ───────── SQLite: yalnızca kayıt ve tarama özeti. Bulunan isimler ve ignore listesi yazılmaz. ─────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT,
    company TEXT,
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    pages_total INTEGER,
    pages_scanned INTEGER,
    hit_count INTEGER,
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
  );
`);
// Kuyruk bellekte: yeniden başlatmada yarım kalan taramalar failed olarak kapatılır.
db.prepare(`UPDATE scans SET status = 'failed', error = 'interrupted: server restarted',
  finished_at = CURRENT_TIMESTAMP WHERE status IN ('pending', 'running')`).run();

const insertScan = db.prepare('INSERT INTO scans (email, full_name, company, domain) VALUES (?, ?, ?, ?)');
const markRunning = db.prepare("UPDATE scans SET status = 'running' WHERE id = ?");
const finishScan = db.prepare(`UPDATE scans SET status = ?, pages_total = ?, pages_scanned = ?, hit_count = ?,
  error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`);

// ───────── Tarama ─────────
async function runScan({ id, email, fullName, domain, ignore }) {
  markRunning.run(id);
  const hits = [];
  let pages = 0;
  let scanned = 0;
  try {
    // Sitemap yoksa (tek sayfalık küçük siteler) yalnızca ana sayfa taranır.
    let source = 'sitemap';
    let urls;
    try {
      urls = await findPageUrls(domain);
    } catch (e) {
      console.warn(`[scan ${id}] ${e.message}; falling back to the home page`);
      source = 'homepage';
      urls = [`https://${domain}/`];
    }
    pages = urls.length;
    const started = Date.now();
    console.log(`[scan ${id}] ${domain}: ${pages} URLs (~${Math.ceil((pages * (DELAY_MS + 700)) / 60_000)} min)`);
    for (const [i, url] of urls.entries()) {
      if (i && i % 25 === 0) {
        console.log(`[scan ${id}] ${i}/${pages} pages, ${hits.length} hits, ${Math.round((Date.now() - started) / 1000)}s`);
      }
      try {
        const text = await pageText(url, domain);
        if (text !== null) {
          scanned++;
          for (const h of await detect(text, ignore)) hits.push({ url, ...h });
        }
      } catch (e) {
        console.warn(`[scan ${id}] ${url}: ${e.message}`); // tek sayfa hatası taramayı durdurmaz
      }
      if (DELAY_MS) await sleep(DELAY_MS);
    }
    if (scanned === 0) throw new Error('No pages could be read');
    await sendReport({ to: email, fullName, domain, source, pages, scanned, hits });
    finishScan.run('done', pages, scanned, hits.length, null, id);
    console.log(`[scan ${id}] done: ${scanned}/${pages} pages, ${hits.length} hits`);
  } catch (e) {
    console.error(`[scan ${id}] failed: ${e.message}`);
    finishScan.run('failed', pages, scanned, hits.length, String(e.message).slice(0, 500), id);
    await sendFailure({ to: email, fullName, domain })
      .catch((err) => console.error(`[scan ${id}] failure email error: ${err.message}`));
  } finally {
    hits.length = 0; // bulgular hiçbir yerde saklanmaz
    ignore.clear();
  }
}

// En fazla SCAN_CONCURRENCY tarama aynı anda çalışır.
// ONE_SCAN_PER_SITE=true ise aynı site aynı anda iki kez taranmaz (hedef siteye yük binmesin diye);
// o site için gelen ikinci iş sırada bekler. Test sürecinde kapalı.
const pending = [];
const activeSites = new Set();
let running = 0;
const queued = () => pending.length + running;

function pump() {
  while (running < SCAN_CONCURRENCY) {
    const i = pending.findIndex((entry) => !activeSites.has(entry.key));
    if (i === -1) return;
    const [{ key, job }] = pending.splice(i, 1);
    running++;
    activeSites.add(key);
    runScan(job)
      .catch((e) => console.error(e))
      .finally(() => {
        running--;
        activeSites.delete(key);
        pump();
      });
  }
}

function enqueue(job) {
  // Kısıt kapalıyken her tarama kendi anahtarını alır, yani aynı site paralel taranabilir.
  const key = ONE_SCAN_PER_SITE ? job.domain.replace(/^www\./, '') : `scan:${job.id}`;
  pending.push({ key, job });
  pump();
}

// ───────── Basit, bellek içi rate limit ─────────
const recent = new Map();
function allow(key) {
  if (!RATE_LIMIT_PER_HOUR) return true;
  const now = Date.now();
  const list = (recent.get(key) || []).filter((t) => now - t < 3_600_000);
  const ok = list.length < RATE_LIMIT_PER_HOUR;
  if (ok) list.push(now);
  recent.set(key, list);
  return ok;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of recent) if (list.every((t) => now - t >= 3_600_000)) recent.delete(k);
}, 600_000).unref();

// ───────── HTTP ─────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function messagePage(res, status, title, text) {
  res.status(status).type('html').send(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Mercury Ward</title>
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#060509;color:#f6f3f8;
font:16px/1.6 Inter,system-ui,sans-serif;padding:16px}main{max-width:480px;text-align:center}
h1{font:600 26px/1.2 Poppins,system-ui,sans-serif}p{color:rgba(246,243,248,.66)}a{color:#ff3d9a}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Back to the form</a></p></main></body></html>`);
}

const app = express();
app.set('trust proxy', 1); // Railway proxy arkasında gerçek IP
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/healthz', (_req, res) => res.json({ ok: true, running, waiting: pending.length }));

app.post('/scan', (req, res) => {
  const body = req.body || {};
  // Honeypot: botlar gizli alanı doldurur, onlara sessizce teşekkür sayfası gösterilir.
  if (body.website) return res.redirect(303, '/thanks.html');

  let domain;
  try {
    domain = cleanDomain(body.domain);
  } catch {
    return messagePage(res, 400, 'Check the website address', 'Please enter a website address such as www.your-agency.co.uk.');
  }
  const email = String(body.email || '').trim().slice(0, 254);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return messagePage(res, 400, 'Check your email address', 'We need a valid email address to send the report to.');
  }
  if (!body.consent) {
    return messagePage(res, 400, 'Please confirm', 'Please confirm that you are allowed to request a scan of this website.');
  }
  if (queued() >= MAX_QUEUE) {
    return messagePage(res, 503, 'We are busy', 'Lots of scans are running right now. Please try again in a little while.');
  }
  if (!allow(`ip:${req.ip}`) || !allow(`email:${email.toLowerCase()}`)) {
    return messagePage(res, 429, 'Too many scans', 'You have started several scans recently. Please try again in an hour.');
  }

  // Ignore listesi veritabanına yazılmaz, sadece bu tarama için bellekte tutulur.
  const ignore = new Set(
    String(body.ignore || '').split(/[\n,]/).map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
      .filter(Boolean).slice(0, 500),
  );
  const fullName = String(body.full_name || '').trim().slice(0, 200) || null;
  const company = String(body.company || '').trim().slice(0, 200) || null;
  const { lastInsertRowid } = insertScan.run(email, fullName, company, domain);

  enqueue({ id: Number(lastInsertRowid), email, fullName, domain, ignore });
  res.redirect(303, '/thanks.html');
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Mercury Ward v1 on :${port} · db ${DB_PATH} · mail ${mailTransport} · ${SCAN_CONCURRENCY} parallel scans`);
  if (mailTransport === 'console') console.warn('No RESEND_API_KEY or SMTP_HOST set: emails are only printed to the console.');
});
