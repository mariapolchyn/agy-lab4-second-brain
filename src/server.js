const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const { NotesStore } = require('./store');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '127.0.0.1';
const NOTES_DIR = path.join(__dirname, '../notes');
const PUBLIC_DIR = path.join(__dirname, 'public');

const store = new NotesStore(NOTES_DIR);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Захист від занадто великого тіла запиту (макс 5MB)
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload Too Large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Некоректний JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS заголовки для локальної розробки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || HOST}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  try {
    // ----------------------------------------------------
    // REST API Routes
    // ----------------------------------------------------

    // 1. Отримання списку категорій PARA
    if (req.method === 'GET' && pathname === '/api/categories') {
      const categories = store.getCategories();
      return sendJson(res, 200, categories);
    }

    // 2. Отримання словника тегів
    if (req.method === 'GET' && pathname === '/api/tags') {
      const tags = store.getTags();
      return sendJson(res, 200, tags);
    }

    // 3. Список нотаток з фільтрами (категорія, тег, пошуковий запит)
    if (req.method === 'GET' && pathname === '/api/notes') {
      const category = reqUrl.searchParams.get('category');
      const tag = reqUrl.searchParams.get('tag');
      const q = reqUrl.searchParams.get('q');
      const notes = store.listNotes({ category, tag, q });
      return sendJson(res, 200, notes);
    }

    // 4. Отримання окремої нотатки за шляхом: /api/notes/<relPath>
    if (req.method === 'GET' && pathname.startsWith('/api/notes/')) {
      const notePath = pathname.slice('/api/notes/'.length);
      const note = store.getNote(notePath);
      if (!note) {
        return sendJson(res, 404, { error: 'Нотатку не знайдено' });
      }
      return sendJson(res, 200, note);
    }

    // 5. Створення нової нотатки: POST /api/notes
    if (req.method === 'POST' && pathname === '/api/notes') {
      const body = await parseBody(req);
      const newNote = await store.createNote(body);
      return sendJson(res, 201, newNote);
    }

    // 6. Оновлення нотатки: PUT /api/notes/<relPath>
    if (req.method === 'PUT' && pathname.startsWith('/api/notes/')) {
      const notePath = pathname.slice('/api/notes/'.length);
      const body = await parseBody(req);
      const updated = await store.updateNote(notePath, body);
      return sendJson(res, 200, updated);
    }

    // ----------------------------------------------------
    // Статичні файли (SPA Frontend)
    // ----------------------------------------------------
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const safeStaticPath = path.resolve(PUBLIC_DIR, '.' + filePath);

    if (!safeStaticPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Access Denied');
      return;
    }

    try {
      const fileData = await fs.readFile(safeStaticPath);
      const ext = path.extname(safeStaticPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fileData);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Fallback на index.html для SPA
        try {
          const indexHtml = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexHtml);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Файл не знайдено');
        }
      } else {
        throw err;
      }
    }

  } catch (error) {
    if (error.message.includes('Access Denied')) {
      return sendJson(res, 403, { error: error.message });
    }
    console.error(`Помилка запиту [${req.method} ${pathname}]:`, error);
    return sendJson(res, 500, { error: error.message || 'Внутрішня помилка сервера' });
  }
});

async function startServer() {
  await store.scan();
  server.listen(PORT, HOST, () => {
    console.log(`\n=================================================`);
    console.log(`🧠 Second Brain активний: http://${HOST}:${PORT}`);
    console.log(`📂 Сховище нотаток: ${NOTES_DIR}`);
    console.log(`📄 Завантажено нотаток: ${store.notes.size}`);
    console.log(`=================================================\n`);
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Не вдалося запустити сервер:', err);
    process.exit(1);
  });
}

module.exports = { server, store, startServer };
