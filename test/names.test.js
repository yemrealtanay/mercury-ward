import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../detectors/names.js';

const names = async (text, ignore) => (await detect(text, ignore)).map((h) => h.name);

test('"Contact John Smith" bulgu verir (çakışan eşleşme)', async () => {
  assert.deepEqual(await names('Contact John Smith for a valuation.'), ['John Smith']);
});

test('adres ekleri bulgu vermez', async () => {
  assert.deepEqual(await names('Flat 2, Cleveland Road and 14 James Street, near Victoria Station'), []);
});

test('ignore listesindeki isim raporda yok', async () => {
  const text = 'Speak to Sarah Jones or David Brown today.';
  assert.deepEqual(await names(text, new Set(['sarah jones'])), ['David Brown']);
});

test('bağlam 40 karakter civarında ve isim içinde', async () => {
  const text = `${'x'.repeat(100)} Sarah Jones ${'y'.repeat(100)}`;
  const [hit] = await detect(text);
  assert.ok(hit.context.includes('Sarah Jones'));
  assert.ok(hit.context.length <= 'Sarah Jones'.length + 80);
});

test('aynı sayfada tekrar eden isim tek satır, sayaçlı', async () => {
  const hits = await detect('Emma Clarke, Branch Manager. Call Emma Clarke on 0123.');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].count, 2);
});

test("iyelik eki ve tireli/apostroflu soyadlar", async () => {
  assert.deepEqual(await names("Read Paul O'Brien's guide"), ["Paul O'Brien"]);
  assert.deepEqual(await names('Lucy Smith-Jones joined'), ['Lucy Smith-Jones']);
});

test('bilinmeyen ilk isim ve şirket/sık kelimeler bulgu vermez', async () => {
  assert.deepEqual(await names('Mayfair Lettings and Mark Your Calendar. Victoria Estates Ltd'), []);
});

test('yan yana isim listesi çakışan çift üretmez', async () => {
  assert.deepEqual(await names('Our team: Rachel Riley Neil King Laura King'), ['Rachel Riley', 'Neil King', 'Laura King']);
});

test('"Max" (maksimum) isim sayılmaz', async () => {
  assert.deepEqual(await names('Max Price £500,000 Max Bedroom 4'), []);
});
