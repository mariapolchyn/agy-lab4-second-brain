const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Парсер YAML Frontmatter без зовнішніх залежностей.
 * Підтримує рядки, числа, масиви (списки) та булеві значення.
 */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: text };
  }

  const rawYaml = match[1];
  const content = match[2];
  const data = {};

  const lines = rawYaml.split(/\r?\n/);
  let currentKey = null;
  let isArray = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;

    // Елемент списку: '  - value'
    const arrayItemMatch = line.match(/^\s*-\s+(.*)$/);
    if (arrayItemMatch && currentKey && isArray) {
      let val = arrayItemMatch[1].trim();
      val = val.replace(/^["'](.*)["']$/, '$1');
      data[currentKey].push(val);
      continue;
    }

    // Ключ-значення: 'key: value' або 'key:'
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let val = kvMatch[2].trim();

      if (val === '') {
        // Початок списку або порожнє значення
        currentKey = key;
        isArray = true;
        data[key] = [];
      } else {
        isArray = false;
        currentKey = key;
        // Очищення лапок і приведення типів
        val = val.replace(/^["'](.*)["']$/, '$1');
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(val) && val !== '') val = Number(val);
        data[key] = val;
      }
    }
  }

  return { data, content };
}

/**
 * Серіалізатор YAML Frontmatter назад у текст.
 */
function stringifyFrontmatter(data, content) {
  let yaml = '---\n';
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      yaml += `${key}:\n`;
      for (const item of val) {
        yaml += `  - "${item}"\n`;
      }
    } else if (typeof val === 'string') {
      yaml += `${key}: "${val}"\n`;
    } else {
      yaml += `${key}: ${val}\n`;
    }
  }
  yaml += '---\n\n';
  return yaml + (content || '').trimStart();
}

/**
 * In-Memory сховище та індексатор нотаток.
 */
class NotesStore {
  constructor(notesRootDir) {
    this.rootDir = path.resolve(notesRootDir);
    this.categories = ['Inbox', 'Projects', 'Areas', 'Resources', 'Archives'];
    
    // In-memory структури даних
    this.notes = new Map();         // relPath -> NoteObject
    this.byTitle = new Map();       // normalizedTitle -> NoteObject
    this.tagsIndex = new Map();     // tag -> Set of relPaths
    this.categoryIndex = new Map(); // category -> Set of relPaths
    this.backlinks = new Map();     // relPath -> Set of referrer relPaths
    this.forwardLinks = new Map();  // relPath -> Set of target titles/relPaths
  }

  /**
   * Перевірка шляху для захисту від Path Traversal.
   */
  resolveSafePath(relPath) {
    const absolute = path.resolve(this.rootDir, relPath);
    if (!absolute.startsWith(this.rootDir + path.sep) && absolute !== this.rootDir) {
      throw new Error(`Access Denied: Path ${relPath} traverses outside notes directory`);
    }
    return absolute;
  }

  /**
   * Повне сканування директорії notes/ та побудова індексів.
   */
  async scan() {
    this.notes.clear();
    this.byTitle.clear();
    this.tagsIndex.clear();
    this.categoryIndex.clear();
    this.backlinks.clear();
    this.forwardLinks.clear();

    for (const cat of this.categories) {
      this.categoryIndex.set(cat, new Set());
      const catDir = path.join(this.rootDir, cat);
      try {
        await fs.mkdir(catDir, { recursive: true });
        await this._scanDir(catDir, cat);
      } catch (err) {
        console.error(`Помилка сканування категорії ${cat}:`, err.message);
      }
    }

    this._buildGraph();
    return this.notes.size;
  }

  async _scanDir(dirPath, category) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this._scanDir(fullPath, category);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        await this._loadNoteFile(fullPath, category);
      }
    }
  }

  async _loadNoteFile(fullPath, category) {
    const raw = await fs.readFile(fullPath, 'utf8');
    const { data, content } = parseFrontmatter(raw);
    const relPath = path.relative(this.rootDir, fullPath).replace(/\\/g, '/');

    const title = data.title || path.basename(fullPath, '.md');
    const tags = Array.isArray(data.tags) ? data.tags.map(t => String(t).trim().toLowerCase()) : [];
    const status = data.status || 'active';
    const type = data.type || 'concept';
    const source = data.source || '';
    const created = data.created || new Date().toISOString();
    const updated = data.updated || created;

    const note = {
      relPath,
      filename: path.basename(fullPath),
      category,
      title,
      tags,
      status,
      type,
      source,
      created,
      updated,
      content,
      raw
    };

    this.notes.set(relPath, note);
    this.byTitle.set(title.toLowerCase().trim(), note);

    // Індексація категорій
    if (!this.categoryIndex.has(category)) {
      this.categoryIndex.set(category, new Set());
    }
    this.categoryIndex.get(category).add(relPath);

    // Індексація тегів
    for (const tag of tags) {
      if (!this.tagsIndex.has(tag)) {
        this.tagsIndex.set(tag, new Set());
      }
      this.tagsIndex.get(tag).add(relPath);
    }
  }

  /**
   * Побудова двонаправленого графа зв'язків ([[Wikilinks]] та Backlinks).
   */
  _buildGraph() {
    this.backlinks.clear();
    this.forwardLinks.clear();

    for (const note of this.notes.values()) {
      this.backlinks.set(note.relPath, new Set());
      this.forwardLinks.set(note.relPath, new Set());
    }

    const wikilinkRegex = /\[\[(.*?)\]\]/g;

    for (const [sourcePath, note] of this.notes.entries()) {
      let match;
      while ((match = wikilinkRegex.exec(note.content)) !== null) {
        const rawTarget = match[1].trim();
        // Підтримка синтаксису [[Target|Alias]]
        const targetTitle = rawTarget.split('|')[0].trim();
        if (!targetTitle) continue;

        this.forwardLinks.get(sourcePath).add(targetTitle);

        // Пошук цільової нотатки за назвою або відносним шляхом
        const targetNote = this.byTitle.get(targetTitle.toLowerCase()) || 
          this.notes.get(targetTitle) ||
          this.notes.get(targetTitle.endsWith('.md') ? targetTitle : `${targetTitle}.md`);

        if (targetNote) {
          if (!this.backlinks.has(targetNote.relPath)) {
            this.backlinks.set(targetNote.relPath, new Set());
          }
          this.backlinks.get(targetNote.relPath).add(sourcePath);
        }
      }
    }
  }

  /**
   * Отримання списку нотаток з фільтрацією та сортуванням.
   */
  listNotes({ category, tag, q } = {}) {
    let result = Array.from(this.notes.values());

    if (category && category !== 'All') {
      result = result.filter(n => n.category.toLowerCase() === category.toLowerCase());
    }

    if (tag) {
      const cleanTag = tag.toLowerCase().trim();
      result = result.filter(n => n.tags.includes(cleanTag));
    }

    if (q && q.trim()) {
      const tokens = q.toLowerCase().trim().split(/\s+/);
      result = result.filter(n => {
        const titleLower = n.title.toLowerCase();
        const contentLower = n.content.toLowerCase();
        const tagsStr = n.tags.join(' ');
        
        return tokens.every(token => 
          titleLower.includes(token) || 
          tagsStr.includes(token) || 
          contentLower.includes(token)
        );
      });

      // Ранжування: збіг у заголовку важливіший за збіг у тілі
      const queryLower = q.toLowerCase().trim();
      result.sort((a, b) => {
        const aTitle = a.title.toLowerCase().includes(queryLower);
        const bTitle = b.title.toLowerCase().includes(queryLower);
        if (aTitle && !bTitle) return -1;
        if (!aTitle && bTitle) return 1;
        return new Date(b.updated) - new Date(a.updated);
      });
    } else {
      // Сортування за датою оновлення (найновіші зверху)
      result.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    }

    return result.map(n => ({
      relPath: n.relPath,
      filename: n.filename,
      category: n.category,
      title: n.title,
      tags: n.tags,
      status: n.status,
      type: n.type,
      source: n.source,
      created: n.created,
      updated: n.updated
    }));
  }

  /**
   * Отримання повної нотатки за її relPath або назвою.
   */
  getNote(identifier) {
    let note = this.notes.get(identifier);
    if (!note) {
      note = this.byTitle.get(identifier.toLowerCase().trim());
    }
    if (!note) return null;

    // Зворотні посилання
    const referrerPaths = this.backlinks.get(note.relPath) || new Set();
    const resolvedBacklinks = Array.from(referrerPaths).map(rPath => {
      const refNote = this.notes.get(rPath);
      return {
        relPath: rPath,
        title: refNote ? refNote.title : path.basename(rPath, '.md'),
        category: refNote ? refNote.category : ''
      };
    });

    return {
      ...note,
      backlinks: resolvedBacklinks,
      forwardLinks: Array.from(this.forwardLinks.get(note.relPath) || [])
    };
  }

  /**
   * Створення нової нотатки.
   */
  async createNote({ category, title, tags, status, type, source, content, filename }) {
    if (!this.categories.includes(category)) {
      throw new Error(`Невідома категорія PARA: ${category}`);
    }
    if (!title || !title.trim()) {
      throw new Error('Заголовок нотатки не може бути порожнім');
    }

    const safeFilename = (filename || title)
      .toLowerCase()
      .replace(/[\\/*?:"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') + '.md';

    const relPath = `${category}/${safeFilename}`.replace(/\\/g, '/');
    const fullPath = this.resolveSafePath(relPath);

    const now = new Date().toISOString();
    const cleanTags = Array.isArray(tags) 
      ? tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
      : (typeof tags === 'string' ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : []);

    const data = {
      title: title.trim(),
      created: now,
      updated: now,
      tags: cleanTags,
      status: status || 'active',
      type: type || 'concept',
      source: source || ''
    };

    const fileContent = stringifyFrontmatter(data, content || '');
    await fs.writeFile(fullPath, fileContent, 'utf8');

    // Оновлення індексу
    await this.scan();
    return this.getNote(relPath);
  }

  /**
   * Оновлення існуючої нотатки.
   */
  async updateNote(relPath, { title, tags, status, type, source, content }) {
    const fullPath = this.resolveSafePath(relPath);
    const existing = this.notes.get(relPath);
    if (!existing) {
      throw new Error(`Нотатка не знайдена: ${relPath}`);
    }

    const now = new Date().toISOString();
    const cleanTags = tags !== undefined
      ? (Array.isArray(tags) ? tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : String(tags).split(',').map(t => t.trim().toLowerCase()).filter(Boolean))
      : existing.tags;

    const data = {
      title: (title !== undefined && title.trim()) ? title.trim() : existing.title,
      created: existing.created,
      updated: now,
      tags: cleanTags,
      status: status || existing.status,
      type: type || existing.type,
      source: source !== undefined ? source : existing.source
    };

    const fileContent = stringifyFrontmatter(data, content !== undefined ? content : existing.content);
    await fs.writeFile(fullPath, fileContent, 'utf8');

    // Оновлення індексу
    await this.scan();
    return this.getNote(relPath);
  }

  /**
   * Отримання словника тегів з лічильниками.
   */
  getTags() {
    const result = [];
    for (const [tag, paths] of this.tagsIndex.entries()) {
      result.push({ tag, count: paths.size });
    }
    result.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return result;
  }

  /**
   * Отримання статистики категорій PARA.
   */
  getCategories() {
    return this.categories.map(cat => ({
      name: cat,
      count: (this.categoryIndex.get(cat) || new Set()).size
    }));
  }
}

module.exports = {
  NotesStore,
  parseFrontmatter,
  stringifyFrontmatter
};
