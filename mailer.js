// mailer.js — CSV üretimi, rapor ve hata e-postaları.
// Gönderim yolu ortam değişkenine göre seçilir (ilk bulunan kullanılır):
//   SENDGRID_API_KEY -> SendGrid v3 HTTP API
//   RESEND_API_KEY   -> Resend HTTP API
//   SMTP_HOST        -> nodemailer ile SMTP (Railway Hobby planında SMTP portları kapalı)
//   hiçbiri          -> e-posta gönderilmez, konsola JSON olarak basılır (geliştirme)
import nodemailer from 'nodemailer';

const FROM = process.env.MAIL_FROM || 'Mercury Ward <onboarding@resend.dev>';
const REPLY_TO = process.env.MAIL_REPLY_TO || undefined;

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
            content: [{ type: 'text/plain', value: m.text }],
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
      const info = await t.sendMail(m);
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

export async function sendReport({ to, fullName, domain, pages, scanned, hits }) {
  const subject = `Mercury Ward report: ${domain}`;
  const readLine = scanned === pages
    ? `We scanned all ${plural(pages, 'page')} listed in the sitemap of ${domain}.`
    : `We found ${plural(pages, 'page')} in the sitemap of ${domain} and could read ${scanned} of them.`;

  if (hits.length === 0) {
    return send({
      to,
      subject,
      text: [greet(fullName), '', readLine, 'We did not find any names of people on those pages.', FOOTER].join('\n'),
    });
  }
  const pagesWithHits = new Set(hits.map((h) => h.url)).size;
  return send({
    to,
    subject,
    text: [
      greet(fullName),
      '',
      readLine,
      `We found ${plural(hits.length, 'possible name')} of people across ${plural(pagesWithHits, 'page')}.`,
      '',
      'The attached report.csv lists each page, the name and the text around it, so you can decide',
      'whether it is a real person whose details should not be on the site. The check is automatic,',
      'so expect some false alarms (for example place or business names).',
      FOOTER,
    ].join('\n'),
    attachments: [{ filename: 'report.csv', content: toCsv(hits), contentType: 'text/csv; charset=utf-8' }],
  });
}

export async function sendFailure({ to, fullName, domain }) {
  return send({
    to,
    subject: `Mercury Ward: we could not scan ${domain}`,
    text: [
      greet(fullName),
      '',
      `We could not scan ${domain}. Either we could not reach its sitemap.xml file, or an error`,
      'stopped the scan. Please check that the site publishes a sitemap (for example',
      `https://${domain}/sitemap.xml) and try again.`,
      FOOTER,
    ].join('\n'),
  });
}
