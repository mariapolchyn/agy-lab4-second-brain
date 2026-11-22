const path = require('node:path');
const assert = require('node:assert');
const { NotesStore } = require('../src/store');

async function runTests() {
  console.log('🧪 Запуск тестів NotesStore...');
  const store = new NotesStore(path.join(__dirname, '../notes'));

  // 1. Тест сканування
  const count = await store.scan();
  console.log(`✓ Проскановано нотаток: ${count}`);
  assert.strictEqual(count, 8, `Має бути рівно 8 нотаток, отримано: ${count}`);

  // 2. Тест категорій PARA
  const categories = store.getCategories();
  console.log('✓ Статистика категорій:', categories);
  const catMap = Object.fromEntries(categories.map(c => [c.name, c.count]));
  assert.strictEqual(catMap.Inbox, 1, 'В Inbox має бути 1 нотатка');
  assert.strictEqual(catMap.Projects, 2, 'В Projects має бути 2 нотатки');
  assert.strictEqual(catMap.Areas, 2, 'В Areas має бути 2 нотатки');
  assert.strictEqual(catMap.Resources, 2, 'В Resources має бути 2 нотатки');
  assert.strictEqual(catMap.Archives, 1, 'В Archives має бути 1 нотатка');

  // 3. Тест двонаправлених зв'язків (Backlinks)
  const systolicNote = store.getNote('Resources/systolic-arrays.md');
  assert.ok(systolicNote, 'Нотатка systolic-arrays має існувати');
  assert.ok(
    systolicNote.forwardLinks.some(link => link.includes('Тензорні процесори (TPU)')),
    'systolic-arrays має посилатися на TPU'
  );

  const tpuNote = store.getNote('Resources/tensor-processing-units.md');
  assert.ok(tpuNote, 'Нотатка tensor-processing-units має існувати');
  assert.ok(
    tpuNote.backlinks.some(b => b.relPath === 'Resources/systolic-arrays.md'),
    'TPU має містити backlink від systolic-arrays'
  );
  assert.ok(
    systolicNote.backlinks.some(b => b.relPath === 'Resources/tensor-processing-units.md'),
    'systolic-arrays має містити backlink від TPU'
  );
  console.log('✓ Двонаправлені зв\'язки (Wikilinks + Backlinks) працюють коректно');

  // 4. Тест повнотекстового пошуку
  const searchResults1 = store.listNotes({ q: 'систолічн' });
  assert.ok(searchResults1.length >= 2, 'Має знайти як мінімум systolic-arrays та TPU/MOC');
  console.log(`✓ Пошук "систолічн" повернув ${searchResults1.length} нотаток`);

  const searchResults2 = store.listNotes({ category: 'Projects' });
  assert.strictEqual(searchResults2.length, 2, 'Фільтр за Projects має повернути 2 нотатки');

  const searchResults3 = store.listNotes({ tag: 'fpga' });
  assert.strictEqual(searchResults3.length, 1, 'Фільтр за тегом fpga має повернути 1 нотатку');
  assert.strictEqual(searchResults3[0].title, 'Лабораторна робота 1: Реалізація матричного множника на FPGA');
  console.log('✓ Фільтри за категоріями та тегами працюють коректно');

  // 5. Тест захисту від Path Traversal
  assert.throws(() => {
    store.resolveSafePath('../../passwords.txt');
  }, /Access Denied/, 'Має викидати Access Denied при спробі виходу за межі notes/');
  console.log('✓ Захист від Path Traversal успішно спрацьовує');

  console.log('\n✅ Усі тести NotesStore пройшли успішно!');
}

runTests().catch(err => {
  console.error('❌ Помилка тестування:', err);
  process.exit(1);
});
