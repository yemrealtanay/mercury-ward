import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDomain, sameSite, assertPublicHost, parseSitemap, htmlToText, findPageUrls } from '../scanner.js';
import { toCsv, parseAddress } from '../mailer.js';

test('cleanDomain protokol, yol ve portu atar', () => {
  assert.equal(cleanDomain('https://www.NKRes.co.uk:8443/about?x=1'), 'www.nkres.co.uk');
  assert.equal(cleanDomain(' nkres.co.uk '), 'nkres.co.uk');
});

test('cleanDomain IP adresi ve geçersiz girdiyi reddeder', () => {
  for (const bad of ['127.0.0.1', 'http://10.0.0.5', 'localhost', '[::1]', '', 'not a domain']) {
    assert.throws(() => cleanDomain(bad), bad);
  }
});

test('sameSite www ve alt domainleri kabul eder, başka siteyi etmez', () => {
  assert.ok(sameSite('www.nkres.co.uk', 'nkres.co.uk'));
  assert.ok(sameSite('nkres.co.uk', 'www.nkres.co.uk'));
  assert.ok(sameSite('blog.nkres.co.uk', 'nkres.co.uk'));
  assert.ok(!sameSite('evil.com', 'nkres.co.uk'));
  assert.ok(!sameSite('nkres.co.uk.evil.com', 'nkres.co.uk'));
});

test('SSRF: localhost ve iç ağ adresleri engellenir', async () => {
  for (const host of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '[::1]', 'localhost']) {
    await assert.rejects(assertPublicHost(host), /Blocked/, host);
  }
  await assert.doesNotReject(assertPublicHost('8.8.8.8'));
});

test('localhost için tarama hiç istek atmadan hata verir', async () => {
  await assert.rejects(findPageUrls('localhost.'), /No usable sitemap/);
});

test('parseSitemap urlset ve sitemapindex ayırt eder', () => {
  const urlset = parseSitemap('<urlset><url><loc> https://a.co.uk/1 </loc></url><url><loc>https://a.co.uk/2</loc></url></urlset>');
  assert.deepEqual(urlset, { isIndex: false, locs: ['https://a.co.uk/1', 'https://a.co.uk/2'] });
  const index = parseSitemap('<sitemapindex><sitemap><loc>https://a.co.uk/s1.xml</loc></sitemap></sitemapindex>');
  assert.equal(index.isIndex, true);
});

test('htmlToText script/style atar ve etiketler arasına boşluk koyar', () => {
  const html = '<html><head><style>.a{}</style></head><body><p>Jane</p><p>Doe</p><script>var John = "Smith"</script></body></html>';
  assert.equal(htmlToText(html), 'Jane Doe');
});

test('toCsv kaçış ve formül enjeksiyonu koruması', () => {
  const csv = toCsv([{ url: 'https://a.co.uk/', name: 'John Smith', count: 2, context: '=HYPERLINK("x") "quoted"' }]);
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines[0], 'url,name,occurrences,context');
  assert.equal(lines[1], `"https://a.co.uk/","John Smith","2","'=HYPERLINK(""x"") ""quoted"""`);
});

test('parseAddress isimli ve isimsiz adresleri ayırır', () => {
  assert.deepEqual(parseAddress('Mercury Ward <noreply@a.co.uk>'), { name: 'Mercury Ward', email: 'noreply@a.co.uk' });
  assert.deepEqual(parseAddress('"Mercury Ward" <noreply@a.co.uk>'), { name: 'Mercury Ward', email: 'noreply@a.co.uk' });
  assert.deepEqual(parseAddress('noreply@a.co.uk'), { email: 'noreply@a.co.uk' });
});
