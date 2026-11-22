/**
 * Second Brain — Клієнтська логіка (Vanilla JavaScript)
 */

(function () {
  'use strict';

  // Стан застосунку
  const state = {
    notes: [],
    categories: [],
    tags: [],
    selectedNote: null,
    activeCategory: 'All',
    activeTag: null,
    searchQuery: '',
    isEditing: false,
    isCreatingNew: false
  };

  // DOM-елементи
  const el = {
    notesList: document.getElementById('notes-list'),
    notesCountLabel: document.getElementById('notes-count-label'),
    paraNav: document.getElementById('para-nav'),
    tagsCloud: document.getElementById('tags-cloud'),
    btnClearTag: document.getElementById('btn-clear-tag'),
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    btnNewNote: document.getElementById('btn-new-note'),

    // Відображення нотатки
    noteView: document.getElementById('note-view'),
    viewPlaceholder: document.getElementById('view-placeholder'),
    noteContentWrapper: document.getElementById('note-content-wrapper'),
    viewTitle: document.getElementById('view-title'),
    viewCategory: document.getElementById('view-category'),
    viewStatus: document.getElementById('view-status'),
    viewType: document.getElementById('view-type'),
    viewSourceWrapper: document.getElementById('view-source-wrapper'),
    viewSource: document.getElementById('view-source'),
    viewTags: document.getElementById('view-tags'),
    viewDates: document.getElementById('view-dates'),
    viewBody: document.getElementById('view-body'),
    btnEditNote: document.getElementById('btn-edit-note'),
    backlinksContainer: document.getElementById('backlinks-container'),
    backlinksCount: document.getElementById('backlinks-count'),
    backlinksList: document.getElementById('backlinks-list'),

    // Форма редагування
    noteEditor: document.getElementById('note-editor'),
    editorHeading: document.getElementById('editor-heading'),
    editorForm: document.getElementById('editor-form'),
    editTitle: document.getElementById('edit-title'),
    editCategory: document.getElementById('edit-category'),
    editType: document.getElementById('edit-type'),
    editStatus: document.getElementById('edit-status'),
    editTags: document.getElementById('edit-tags'),
    editSource: document.getElementById('edit-source'),
    editContent: document.getElementById('edit-content'),
    btnSaveNote: document.getElementById('btn-save-note'),
    btnCancelEdit: document.getElementById('btn-cancel-edit')
  };

  // ----------------------------------------------------
  // Markdown & Wikilinks Parser
  // ----------------------------------------------------
  function renderMarkdown(md) {
    if (!md) return '';

    let html = md;

    // 1. Екранування HTML для безпеки
    const escapeHtml = str => str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Збереження блоків коду перед обробкою
    const codeBlocks = [];
    html = html.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
      const id = `___CODE_BLOCK_${codeBlocks.length}___`;
      codeBlocks.push(`<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`);
      return id;
    });

    // Збереження відокремлених математичних блоків $$...$$
    const mathBlocks = [];
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
      const id = `___MATH_BLOCK_${mathBlocks.length}___`;
      mathBlocks.push(`<div class="math-block">$$ ${escapeHtml(math.trim())} $$</div>`);
      return id;
    });

    // 2. Wikilinks: [[Назва нотатки]] або [[Назва|Аліас]]
    html = html.replace(/\[\[(.*?)\]\]/g, (match, rawLink) => {
      const parts = rawLink.split('|');
      const target = parts[0].trim();
      const alias = parts.length > 1 ? parts[1].trim() : target;
      return `<a href="#" class="wikilink" data-target="${escapeHtml(target)}">${escapeHtml(alias)}</a>`;
    });

    // 3. Заголовки
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // 4. Цитати (Blockquotes)
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

    // 5. Жирний та курсив
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 6. Інлайн-код
    html = html.replace(/`([^`]+)`/g, (match, code) => `<code>${escapeHtml(code)}</code>`);

    // 7. Списки завдань та марковані списки
    html = html.replace(/^- \[x\] (.*$)/gim, '<li><input type="checkbox" checked disabled> $1</li>');
    html = html.replace(/^- \[ \] (.*$)/gim, '<li><input type="checkbox" disabled> $1</li>');
    html = html.replace(/^- (.*$)/gim, '<li>$1</li>');

    // Обгортка для <li>
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    // 8. Розриви рядків і параграфи
    const paragraphs = html.split(/\r?\n\r?\n/);
    html = paragraphs.map(p => {
      p = p.trim();
      if (!p) return '';
      if (/^<h[1-6]|<ul|<pre|<blockquote|<div/.test(p)) return p;
      return `<p>${p.replace(/\r?\n/g, '<br>')}</p>`;
    }).join('\n');

    // Відновлення коду та математики
    for (let i = 0; i < codeBlocks.length; i++) {
      html = html.replace(`___CODE_BLOCK_${i}___`, codeBlocks[i]);
    }
    for (let i = 0; i < mathBlocks.length; i++) {
      html = html.replace(`___MATH_BLOCK_${i}___`, mathBlocks[i]);
    }

    return html;
  }

  // ----------------------------------------------------
  // API Запити
  // ----------------------------------------------------
  async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function loadCategories() {
    state.categories = await apiFetch('/api/categories');
    let total = 0;
    for (const cat of state.categories) {
      total += cat.count;
      const badge = document.getElementById(`count-${cat.name.toLowerCase()}`);
      if (badge) badge.textContent = cat.count;
    }
    const countAll = document.getElementById('count-all');
    if (countAll) countAll.textContent = total;
  }

  async function loadTags() {
    state.tags = await apiFetch('/api/tags');
    renderTagsCloud();
  }

  async function loadNotes() {
    const params = new URLSearchParams();
    if (state.activeCategory && state.activeCategory !== 'All') {
      params.set('category', state.activeCategory);
    }
    if (state.activeTag) {
      params.set('tag', state.activeTag);
    }
    if (state.searchQuery) {
      params.set('q', state.searchQuery);
    }

    state.notes = await apiFetch(`/api/notes?${params.toString()}`);
    renderNotesList();
  }

  async function openNote(identifier) {
    try {
      const note = await apiFetch(`/api/notes/${encodeURIComponent(identifier)}`);
      state.selectedNote = note;
      showNoteView();
      renderActiveNote();
      renderNotesList(); // оновлення підсвічування картки
    } catch (err) {
      alert(`Не вдалося відкрити нотатку: ${err.message}`);
    }
  }

  // ----------------------------------------------------
  // Рендеринг інтерфейсу
  // ----------------------------------------------------
  function renderTagsCloud() {
    el.tagsCloud.innerHTML = '';
    for (const item of state.tags) {
      const pill = document.createElement('button');
      pill.className = `tag-pill ${state.activeTag === item.tag ? 'active' : ''}`;
      pill.textContent = `#${item.tag} (${item.count})`;
      pill.addEventListener('click', () => {
        if (state.activeTag === item.tag) {
          state.activeTag = null;
          el.btnClearTag.style.display = 'none';
        } else {
          state.activeTag = item.tag;
          el.btnClearTag.style.display = 'inline-block';
        }
        renderTagsCloud();
        loadNotes();
      });
      el.tagsCloud.appendChild(pill);
    }
  }

  function renderNotesList() {
    el.notesList.innerHTML = '';
    el.notesCountLabel.textContent = `Нотатки (${state.notes.length})`;

    if (state.notes.length === 0) {
      el.notesList.innerHTML = '<p class="text-muted" style="padding: 16px; text-align: center;">Нотаток не знайдено</p>';
      return;
    }

    for (const note of state.notes) {
      const card = document.createElement('div');
      const isSelected = state.selectedNote && state.selectedNote.relPath === note.relPath;
      card.className = `note-card ${isSelected ? 'active' : ''}`;

      const tagsHtml = note.tags && note.tags.length > 0
        ? `<div class="note-card-tags">${note.tags.slice(0, 3).map(t => `<span class="note-mini-tag">#${t}</span>`).join('')}</div>`
        : '';

      const updatedDate = new Date(note.updated).toLocaleDateString('uk-UA', {
        month: 'short',
        day: 'numeric'
      });

      card.innerHTML = `
        <div class="note-card-header">
          <div class="note-card-title">${note.title}</div>
          <span class="note-card-cat">${note.category}</span>
        </div>
        <div class="note-card-meta">
          <span>${note.type}</span>
          <span>•</span>
          <span>${updatedDate}</span>
        </div>
        ${tagsHtml}
      `;

      card.addEventListener('click', () => {
        openNote(note.relPath);
      });

      el.notesList.appendChild(card);
    }
  }

  function renderActiveNote() {
    if (!state.selectedNote) {
      el.viewPlaceholder.style.display = 'flex';
      el.noteContentWrapper.style.display = 'none';
      return;
    }

    const note = state.selectedNote;
    el.viewPlaceholder.style.display = 'none';
    el.noteContentWrapper.style.display = 'block';

    el.viewTitle.textContent = note.title;
    el.viewCategory.textContent = note.category;
    el.viewStatus.textContent = note.status;
    el.viewType.textContent = note.type;

    if (note.source) {
      el.viewSourceWrapper.style.display = 'block';
      el.viewSource.textContent = note.source;
    } else {
      el.viewSourceWrapper.style.display = 'none';
    }

    el.viewTags.innerHTML = (note.tags || []).map(t => `<span class="note-tag">#${t}</span>`).join('');

    const createdStr = new Date(note.created).toLocaleString('uk-UA');
    const updatedStr = new Date(note.updated).toLocaleString('uk-UA');
    el.viewDates.textContent = `Створено: ${createdStr} | Оновлено: ${updatedStr}`;

    // Рендеринг контенту з підтримкою Wikilinks
    el.viewBody.innerHTML = renderMarkdown(note.content);

    // Додавання клікабельності для посилань [[Wikilink]]
    const wikilinks = el.viewBody.querySelectorAll('.wikilink');
    wikilinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = link.getAttribute('data-target');
        if (target) {
          openNote(target);
        }
      });
    });

    // Рендеринг зворотних зв'язків (Backlinks)
    const backlinks = note.backlinks || [];
    el.backlinksCount.textContent = backlinks.length;
    el.backlinksList.innerHTML = '';

    if (backlinks.length === 0) {
      el.backlinksList.innerHTML = '<p class="text-muted">Немає інших нотаток, які посилаються на цю тему.</p>';
    } else {
      for (const b of backlinks) {
        const item = document.createElement('div');
        item.className = 'backlink-item';
        item.innerHTML = `
          <span class="backlink-title">🔗 ${b.title}</span>
          <span class="backlink-cat">${b.category}</span>
        `;
        item.addEventListener('click', () => {
          openNote(b.relPath);
        });
        el.backlinksList.appendChild(item);
      }
    }
  }

  function showNoteView() {
    state.isEditing = false;
    state.isCreatingNew = false;
    el.noteView.style.display = 'block';
    el.noteEditor.style.display = 'none';
  }

  function showEditor(isNew = false) {
    state.isEditing = true;
    state.isCreatingNew = isNew;
    el.noteView.style.display = 'none';
    el.noteEditor.style.display = 'flex';

    if (isNew) {
      el.editorHeading.textContent = 'Нова нотатка';
      el.editTitle.value = '';
      el.editCategory.value = (state.activeCategory && state.activeCategory !== 'All') ? state.activeCategory : 'Inbox';
      el.editType.value = 'concept';
      el.editStatus.value = 'active';
      el.editTags.value = state.activeTag ? state.activeTag : '';
      el.editSource.value = '';
      el.editContent.value = '';
      el.editTitle.focus();
    } else if (state.selectedNote) {
      const note = state.selectedNote;
      el.editorHeading.textContent = `Редагування: ${note.title}`;
      el.editTitle.value = note.title;
      el.editCategory.value = note.category;
      el.editCategory.disabled = true; // заборона зміни папки в режимі простого редагування
      el.editType.value = note.type;
      el.editStatus.value = note.status;
      el.editTags.value = (note.tags || []).join(', ');
      el.editSource.value = note.source || '';
      el.editContent.value = note.content || '';
      el.editTitle.focus();
    }
  }

  // ----------------------------------------------------
  // Обробники подій
  // ----------------------------------------------------

  // Вкладки категорій PARA
  el.paraNav.addEventListener('click', (e) => {
    const tab = e.target.closest('.para-tab');
    if (!tab) return;
    const cat = tab.getAttribute('data-category');
    state.activeCategory = cat;

    document.querySelectorAll('.para-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    loadNotes();
  });

  // Очищення вибору тегу
  el.btnClearTag.addEventListener('click', () => {
    state.activeTag = null;
    el.btnClearTag.style.display = 'none';
    renderTagsCloud();
    loadNotes();
  });

  // Пошук з debounce
  let searchTimeout = null;
  el.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    state.searchQuery = e.target.value.trim();
    el.searchClear.style.display = state.searchQuery ? 'block' : 'none';

    searchTimeout = setTimeout(() => {
      loadNotes();
    }, 150);
  });

  el.searchClear.addEventListener('click', () => {
    el.searchInput.value = '';
    state.searchQuery = '';
    el.searchClear.style.display = 'none';
    loadNotes();
  });

  // Кнопка "+ Нова нотатка"
  el.btnNewNote.addEventListener('click', () => {
    showEditor(true);
  });

  // Кнопка "Редагувати"
  el.btnEditNote.addEventListener('click', () => {
    if (state.selectedNote) {
      showEditor(false);
    }
  });

  // Скасування редагування
  el.btnCancelEdit.addEventListener('click', () => {
    showNoteView();
    if (state.selectedNote) {
      renderActiveNote();
    }
  });

  // Збереження форми
  el.btnSaveNote.addEventListener('click', async (e) => {
    e.preventDefault();
    const title = el.editTitle.value.trim();
    if (!title) {
      alert('Будь ласка, вкажіть заголовок нотатки');
      el.editTitle.focus();
      return;
    }

    const payload = {
      title,
      category: el.editCategory.value,
      type: el.editType.value,
      status: el.editStatus.value,
      tags: el.editTags.value,
      source: el.editSource.value.trim(),
      content: el.editContent.value
    };

    try {
      let savedNote;
      if (state.isCreatingNew) {
        savedNote = await apiFetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        savedNote = await apiFetch(`/api/notes/${encodeURIComponent(state.selectedNote.relPath)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      state.selectedNote = savedNote;
      await loadCategories();
      await loadTags();
      await loadNotes();

      showNoteView();
      renderActiveNote();
    } catch (err) {
      alert(`Помилка збереження нотатки: ${err.message}`);
    }
  });

  // ----------------------------------------------------
  // Ініціалізація
  // ----------------------------------------------------
  async function init() {
    try {
      await Promise.all([loadCategories(), loadTags(), loadNotes()]);

      // Відкрити першу нотатку за замовчуванням (MOC або першу в списку)
      if (state.notes.length > 0) {
        const moc = state.notes.find(n => n.type === 'moc') || state.notes[0];
        openNote(moc.relPath);
      }
    } catch (err) {
      console.error('Помилка ініціалізації додатку:', err);
    }
  }

  init();
})();
