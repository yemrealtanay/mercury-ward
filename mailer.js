// mailer.js — CSV üretimi, rapor ve hata e-postaları.
// Gönderim yolu ortam değişkenine göre seçilir (ilk bulunan kullanılır):
//   SENDGRID_API_KEY -> SendGrid v3 HTTP API
//   RESEND_API_KEY   -> Resend HTTP API
//   SMTP_HOST        -> nodemailer ile SMTP (Railway Hobby planında SMTP portları kapalı)
//   hiçbiri          -> e-posta gönderilmez, konsola JSON olarak basılır (geliştirme)
import nodemailer from 'nodemailer';
import { renderEmail } from './email-template.js';

const FROM = process.env.MAIL_FROM || 'Mercury Ward <onboarding@resend.dev>';
const REPLY_TO = process.env.MAIL_REPLY_TO || undefined;
// E-postadaki "Scan another website" butonu için. Railway public domain'i otomatik verir.
// Yalnızca gönderen domain'le uyumlu bir adres (ör. https://mercuryward.co.uk) verilirse buton eklenir.
// *.up.railway.app gibi paylaşımlı alan adları Microsoft'ta spam/phishing sinyali olduğu için kullanılmaz.
const SITE_URL = (() => {
  const url = process.env.PUBLIC_URL;
  if (!url) return null;
  try {
    return /(^|\.)(railway\.app|up\.railway\.app)$/i.test(new URL(url).hostname) ? null : url;
  } catch {
    return null;
  }
})();
const MAX_PREVIEW = 8;

// "Mercury Ward <noreply@site.co.uk>" -> { name: 'Mercury Ward', email: 'noreply@site.co.uk' }
export function parseAddress(value) {
  const s = String(value || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: s };
}

function createSender() {
  if (process.env.SENDGRID_API_KEY) {
    return {
      name: 'sendgrid',
      async send(m) {
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: m.to }] }],
            from: parseAddress(m.from),
            reply_to: m.replyTo ? parseAddress(m.replyTo) : undefined,
            subject: m.subject,
            content: [
              { type: 'text/plain', value: m.text },
              ...(m.html ? [{ type: 'text/html', value: m.html }] : []),
            ],
            attachments: m.attachments?.map((a) => ({
              filename: a.filename,
              type: a.contentType?.split(';')[0],
              disposition: 'attachment',
              content: Buffer.from(a.content, 'utf8').toString('base64'),
            })),
            // Rapor e-postalarındaki linkler SendGrid'in takip linkleriyle değiştirilmesin.
            tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 300)}`);
        // Activity Feed'de bu ID ile aranabilir.
        console.log(`[mail] SendGrid accepted (${res.status}) "${m.subject}" msg_id=${res.headers.get('x-message-id')}`);
      },
    };
  }
  if (process.env.RESEND_API_KEY) {
    return {
      name: 'resend',
      async send(m) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: m.from,
            to: [m.to],
            reply_to: m.replyTo,
            subject: m.subject,
            text: m.text,
            html: m.html,
            attachments: m.attachments?.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content, 'utf8').toString('base64'),
            })),
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      },
    };
  }
  if (process.env.SMTP_HOST) {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    return { name: 'smtp', send: (m) => t.sendMail(m) };
  }
  const t = nodemailer.createTransport({ jsonTransport: true });
  return {
    name: 'console',
    async send(m) {
      const info = await t.sendMail({ ...m, html: m.html ? `[${m.html.length} chars of HTML]` : undefined });
      console.log(`[mail:console] ${info.message}`);
    },
  };
}

const sender = createSender();
export const mailTransport = sender.name;

function send(message) {
  return sender.send({ from: FROM, replyTo: REPLY_TO, ...message });
}

// Excel'de formül olarak çalışmasın diye =,+,-,@ ile başlayan hücrelerin başına ' eklenir.
export function toCsv(hits) {
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const rows = hits.map((h) => [h.url, h.name, h.count ?? 1, h.context].map(esc).join(','));
  // BOM: Excel UTF-8'i doğru açsın
  return `﻿${['url,name,occurrences,context', ...rows].join('\r\n')}\r\n`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const greet = (fullName) => {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi,';
};

const FOOTER = [
  '',
  'Mercury Ward is a free data privacy awareness initiative by Iceberg Digital.',
  'We do not keep a copy of this report or the names in it. It is an awareness tool, not legal advice.',
].join('\n');

// Raporda aynı isim birçok sayfada geçebilir (ör. footer'daki personel). Önizleme isim bazında toplanır.
export function topNames(hits, limit = MAX_PREVIEW) {
  const byName = new Map();
  for (const h of hits) {
    const e = byName.get(h.name) || { name: h.name, urls: [] };
    e.urls.push(h.url);
    byName.set(h.name, e);
  }
  const all = [...byName.values()].sort((a, b) => b.urls.length - a.urls.length || a.name.localeCompare(b.name));
  const pathOf = (u) => {
    try {
      const path = new URL(u).pathname;
      return !path || path === '/' ? 'home page' : path;
    } catch {
      return u;
    }
  };
  return {
    total: all.length,
    top: all.slice(0, limit).map((e) => ({
      name: e.name,
      where: e.urls.length === 1 ? pathOf(e.urls[0]) : `${pathOf(e.urls[0])} and ${plural(e.urls.length - 1, 'other page')}`,
      badge: plural(e.urls.length, 'page'),
    })),
  };
}

const scanButton = () => (SITE_URL ? { href: SITE_URL, label: 'Scan another website' } : null);

export function buildReport({ fullName, domain, source = 'sitemap', pages, scanned, hits }) {
  const subject = `Mercury Ward report: ${domain}`;
  const readLine = source === 'homepage'
    ? `We could not find a sitemap for ${domain}, so we scanned its home page only.`
    : scanned === pages
      ? `We scanned all ${plural(pages, 'page')} listed in the sitemap of ${domain}.`
      : `We found ${plural(pages, 'page')} in the sitemap of ${domain} and could read ${scanned} of them.`;
  const stats = [
    { label: source === 'homepage' ? 'Home page only' : 'Pages in sitemap', value: pages },
    { label: 'Pages read', value: scanned },
    { label: 'Possible names', value: new Set(hits.map((h) => h.name)).size },
  ];

  if (hits.length === 0) {
    const none = `We did not find any names of people on ${scanned === 1 ? 'that page' : 'those pages'}.`;
    return {
      subject,
      text: [greet(fullName), '', readLine, none, FOOTER].join('\n'),
      html: renderEmail({
        preheader: `No names found on ${domain}.`,
        greeting: greet(fullName),
        title: `No names found on ${domain}`,
        paragraphs: [readLine, none],
        stats,
        button: scanButton(),
      }),
    };
  }

  const pagesWithHits = new Set(hits.map((h) => h.url)).size;
  const { top, total } = topNames(hits);
  const foundLine = `We found ${plural(total, 'possible name')} of people across ${plural(pagesWithHits, 'page')}.`;
  const csvLine = 'The attached report.csv lists each page, the name and the text around it, so you can decide '
    + 'whether it is a real person whose details should not be on the site. The check is automatic, '
    + 'so expect some false alarms (for example place or business names).';
  return {
    subject,
    text: [greet(fullName), '', readLine, foundLine, '', csvLine, FOOTER].join('\n'),
    html: renderEmail({
      preheader: `${foundLine} Full details in report.csv.`,
      greeting: greet(fullName),
      title: `We found ${plural(total, 'possible name')} on ${domain}`,
      paragraphs: [readLine],
      stats,
      findings: top,
      moreFindings: total - top.length,
      note: csvLine,
      button: scanButton(),
    }),
    attachments: [{ filename: 'report.csv', content: toCsv(hits), contentType: 'text/csv; charset=utf-8' }],
  };
}

export function buildFailure({ fullName, domain }) {
  const lines = [
    `We could not read any pages on ${domain}, or an error stopped the scan.`,
    `Please check that https://${domain}/ opens in a browser and try again.`,
  ];
  return {
    subject: `Mercury Ward: we could not scan ${domain}`,
    text: [greet(fullName), '', `We could not scan ${domain}.`, ...lines, FOOTER].join('\n'),
    html: renderEmail({
      tone: 'error',
      preheader: `We could not scan ${domain}.`,
      greeting: greet(fullName),
      title: `We could not scan ${domain}`,
      paragraphs: lines,
      button: SITE_URL ? { href: SITE_URL, label: 'Try again' } : null,
    }),
  };
}

export async function sendReport({ to, ...scan }) {
  return send({ to, ...buildReport(scan) });
}

export async function sendFailure({ to, ...scan }) {
  return send({ to, ...buildFailure(scan) });
}
