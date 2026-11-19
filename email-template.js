// email-template.js — sitenin görünümüne uygun HTML e-posta şablonu.
// E-posta istemcileri için: tablo düzeni, satır içi stil, harici CSS/SVG/görsel yok.
// Sayfalardan gelen her metin (isim, bağlam, domain) esc() ile kaçırılır.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const C = {
  bg: '#060509',
  card: '#0e0a12',
  tile: '#170f1b',
  line: '#2a1f2e',
  text: '#f6f3f8',
  muted: '#bdb6c1',
  faint: '#857e89',
  pink: '#e6197d',
  pinkHot: '#ff3d9a',
  pinkSoft: '#ffd2e7',
};
const FONT = "Inter, 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "Poppins, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, monospace";

const p = (html, extra = '') =>
  `<p style="margin:0 0 14px;font:400 15px/1.6 ${FONT};color:${C.muted};${extra}">${html}</p>`;

function statsBlock(stats) {
  if (!stats?.length) return '';
  const cells = stats.map((s) => `
    <td width="${Math.floor(100 / stats.length)}%" style="padding:0 4px;" valign="top">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background:${C.tile};border:1px solid ${C.line};border-radius:12px;">
        <tr><td style="padding:16px 14px;">
          <div style="font:600 26px/1.1 ${DISPLAY};color:${C.pinkHot};">${esc(s.value)}</div>
          <div style="margin-top:6px;font:600 10px/1.4 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:${C.faint};">${esc(s.label)}</div>
        </td></tr>
      </table>
    </td>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;">
    <tr><td style="padding:0 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin:0 -4px;"><tr>${cells}</tr></table></td></tr></table>`;
}

function findingsBlock(findings, more) {
  if (!findings?.length) return '';
  const rows = findings.map((f) => `
    <tr>
      <td style="padding:12px 0;border-top:1px solid ${C.line};" valign="top">
        <div style="font:600 15px/1.4 ${FONT};color:${C.text};">${esc(f.name)}</div>
        <div style="margin-top:2px;font:400 12px/1.5 ${MONO};color:${C.faint};word-break:break-all;">${esc(f.where)}</div>
      </td>
      <td align="right" style="padding:12px 0 12px 12px;border-top:1px solid ${C.line};white-space:nowrap;" valign="top">
        <span style="display:inline-block;padding:3px 9px;border-radius:999px;background:#2a0f1f;border:1px solid #5a1a3b;font:600 11px/1.4 ${FONT};color:${C.pinkSoft};">${esc(f.badge)}</span>
      </td>
    </tr>`).join('');
  const moreRow = more > 0
    ? `<tr><td colspan="2" style="padding:12px 0 0;border-top:1px solid ${C.line};font:400 13px/1.5 ${FONT};color:${C.faint};">and ${esc(more)} more in report.csv</td></tr>`
    : '';
  return `
    <div style="margin:4px 0 8px;font:600 11px/1.4 ${FONT};letter-spacing:2px;text-transform:uppercase;color:${C.pinkHot};">Most frequent names</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px;">${rows}${moreRow}</table>`;
}

function buttonBlock(button) {
  if (!button) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
    <tr><td style="border-radius:12px;background:${C.pink};background-image:linear-gradient(135deg,${C.pink},#b3105f);">
      <a href="${esc(button.href)}" style="display:inline-block;padding:14px 24px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:12px;">${esc(button.label)}</a>
    </td></tr></table>`;
}

/**
 * @param {object} o
 * @param {string} o.preheader  Gelen kutusunda konu satırının yanında görünen kısa metin
 * @param {string} o.title
 * @param {string} [o.greeting]
 * @param {string[]} [o.paragraphs]  Düz metin; kaçırılarak eklenir
 * @param {{label:string,value:string|number}[]} [o.stats]
 * @param {{name:string,where:string,badge:string}[]} [o.findings]
 * @param {number} [o.moreFindings]
 * @param {string} [o.note]
 * @param {{href:string,label:string}} [o.button]
 * @param {'default'|'error'} [o.tone]
 */
export function renderEmail(o) {
  const accent = o.tone === 'error' ? '#ffb547' : C.pink;
  const body = [
    o.greeting ? p(esc(o.greeting), `color:${C.text};`) : '',
    `<h1 style="margin:0 0 16px;font:600 24px/1.25 ${DISPLAY};color:${C.text};">${esc(o.title)}</h1>`,
    ...(o.paragraphs || []).map((t) => p(esc(t))),
    statsBlock(o.stats),
    findingsBlock(o.findings, o.moreFindings),
    o.note ? p(esc(o.note), `font-size:14px;`) : '',
    buttonBlock(o.button),
  ].join('');

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(o.preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:32px 16px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

      <tr><td style="padding:0 4px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font:600 13px/1 ${DISPLAY};letter-spacing:4px;text-transform:uppercase;color:${C.text};">
            <span style="color:${C.pink};letter-spacing:0;">&#9650;</span>&nbsp; Mercury Ward
          </td>
          <td align="right">
            <span style="display:inline-block;padding:5px 11px;border-radius:999px;border:1px solid #6b1a43;background:#1c0a14;font:600 10px/1 ${FONT};letter-spacing:2px;text-transform:uppercase;color:${C.pinkSoft};">Beta</span>
          </td>
        </tr></table>
      </td></tr>

      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:18px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="height:4px;line-height:4px;font-size:0;background:${accent};background-image:linear-gradient(90deg,#ff6bb5,${accent});border-radius:18px 18px 0 0;">&nbsp;</td></tr>
          <tr><td style="padding:32px 32px 28px;">${body}</td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:28px 8px 0;text-align:center;">
        <div style="font:600 11px/1.6 ${FONT};letter-spacing:2.5px;text-transform:uppercase;color:${C.faint};">An Iceberg X initiative by Iceberg Digital</div>
        <div style="margin-top:10px;font:400 12px/1.6 ${FONT};color:${C.faint};">
          A free data privacy awareness initiative for the UK estate agency industry.<br>
          We do not keep a copy of this report or the names in it. An awareness tool, not legal advice.
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
