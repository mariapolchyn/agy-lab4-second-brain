const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert');
const { server, store } = require('../src/server');

const TEST_PORT = 3099;

function request(method, pathUrl, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: pathUrl,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: json || data });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runApiTests() {
  console.log('🧪 Запуск інтеграційних тестів HTTP REST API...');

  await store.scan();
  await new Promise(resolve => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`✓ Тестовий сервер запущено на порту ${TEST_PORT}`);

  try {
    // 1. Тест GET /api/categories
    const resCat = await request('GET', '/api/categories');
    assert.strictEqual(resCat.statusCode, 200);
    assert.ok(Array.isArray(resCat.body));
    assert.strictEqual(resCat.body.length, 5);
    console.log('✓ GET /api/categories повертає 5 категорій PARA');

    // 2. Тест GET /api/tags
    const resTags = await request('GET', '/api/tags');
    assert.strictEqual(resTags.statusCode, 200);
    assert.ok(Array.isArray(resTags.body));
    assert.ok(resTags.body.some(t => t.tag === 'fpga'));
    console.log(`✓ GET /api/tags повернув ${resTags.body.length} унікальних тегів`);

    // 3. Тест GET /api/notes
    const resNotes = await request('GET', '/api/notes');
    assert.strictEqual(resNotes.statusCode, 200);
    assert.strictEqual(resNotes.body.length, 8);
    console.log('✓ GET /api/notes повернув 8 базових нотаток');

    // 4. Тест пошуку GET /api/notes?q=VLIW
    const resSearch = await request('GET', '/api/notes?q=VLIW');
    assert.strictEqual(resSearch.statusCode, 200);
    assert.ok(resSearch.body.length >= 1);
    assert.ok(resSearch.body.some(n => n.title.includes('VLIW')));
    console.log('✓ GET /api/notes?q=VLIW знаходить курсовий проєкт');

    // 5. Тест отримання нотатки зі зворотними посиланнями
    const resSingle = await request('GET', '/api/notes/Resources%2Ftensor-processing-units.md');
    assert.strictEqual(resSingle.statusCode, 200);
    assert.strictEqual(resSingle.body.title, 'Тензорні процесори (TPU) для машинного навчання');
    assert.ok(resSingle.body.backlinks.some(b => b.relPath === 'Resources/systolic-arrays.md'));
    console.log('✓ GET /api/notes/:path повертає детальну нотатку з валідними backlinks');

    // 6. Тест створення нової нотатки через POST /api/notes
    const newNotePayload = {
      title: 'Тестова нотатка конвеєризації',
      category: 'Inbox',
      type: 'lecture',
      status: 'inbox',
      tags: 'тест, конвеєр',
      source: 'Автотест API',
      content: 'Тіло тестової нотатки з посиланням на [[Систолічні матриці в апаратних прискорювачах]].'
    };
    const resCreate = await request('POST', '/api/notes', newNotePayload);
    assert.strictEqual(resCreate.statusCode, 201);
    assert.strictEqual(resCreate.body.title, newNotePayload.title);
    const createdRelPath = resCreate.body.relPath;
    console.log(`✓ POST /api/notes успішно створив нотатку на диску: ${createdRelPath}`);

    // Перевірка оновлення backlinks після створення
    const resSystolic = await request('GET', '/api/notes/Resources%2Fsystolic-arrays.md');
    assert.ok(resSystolic.body.backlinks.some(b => b.relPath === createdRelPath));
    console.log('✓ Нова нотатка автоматично додала backlink до цільової теми');

    // 7. Тест оновлення через PUT
    const updatePayload = {
      title: 'Тестова нотатка (Оновлено)',
      tags: 'тест, оновлено'
    };
    const resUpdate = await request('PUT', `/api/notes/${encodeURIComponent(createdRelPath)}`, updatePayload);
    assert.strictEqual(resUpdate.statusCode, 200);
    assert.strictEqual(resUpdate.body.title, 'Тестова нотатка (Оновлено)');
    console.log('✓ PUT /api/notes/:path оновив метадані нотатки');

    // 8. Тест статичних файлів веб-інтерфейсу
    const resIndex = await request('GET', '/');
    assert.strictEqual(resIndex.statusCode, 200);
    assert.ok(resIndex.body.includes('Second Brain'));

    const resCss = await request('GET', '/style.css');
    assert.strictEqual(resCss.statusCode, 200);
    assert.ok(resCss.body.includes('--bg-app'));

    const resJs = await request('GET', '/app.js');
    assert.strictEqual(resJs.statusCode, 200);
    assert.ok(resJs.body.includes('renderMarkdown'));
    console.log('✓ Статичні файли SPA (index.html, style.css, app.js) віддаються коректно');

    // Очищення тестового файлу
    const testFileAbs = path.join(__dirname, '../notes', createdRelPath);
    await fs.unlink(testFileAbs);
    await store.scan();
    console.log('✓ Тестовий файл видалено з диска, індекс відновлено');

    console.log('\n✅ Всі інтеграційні тести API пройшли успішно!');
  } finally {
    server.close();
  }
}

runApiTests().catch(err => {
  console.error('❌ Помилка інтеграційних тестів:', err);
  process.exit(1);
});
