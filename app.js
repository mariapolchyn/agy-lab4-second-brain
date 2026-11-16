/**
 * Додаток "Навчальні нотатки" (Second Brain)
 * Локальне збереження через LocalStorage, валідація, керування нотатками.
 */

const STORAGE_KEY = 'study_notes_v1';

// Елементи DOM
const form = document.getElementById('note-form');
const titleInput = document.getElementById('note-title');
const subjectInput = document.getElementById('note-subject');
const tagsInput = document.getElementById('note-tags');
const contentInput = document.getElementById('note-content');

const titleError = document.getElementById('title-error');
const subjectError = document.getElementById('subject-error');
const contentError = document.getElementById('content-error');

const notesList = document.getElementById('notes-list');
const emptyState = document.getElementById('empty-state');
const notesCount = document.getElementById('notes-count');

/**
 * Отримання списку нотаток зі сховища LocalStorage
 * @returns {Array} Масив збережених нотаток
 */
function getNotesFromStorage() {
  try {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (!rawData) return [];
    const parsed = JSON.parse(rawData);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Помилка при читанні з LocalStorage:', error);
    return [];
  }
}

/**
 * Збереження списку нотаток у LocalStorage
 * @param {Array} notes 
 */
function saveNotesToStorage(notes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (error) {
    console.error('Помилка при записі у LocalStorage:', error);
    alert('Не вдалося зберегти нотатку: пам’ять браузера переповнена або заблокована.');
  }
}

/**
 * Форматування дати у зрозумілий локалізований вигляд
 * @param {string|number} dateString 
 * @returns {string}
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Очищення повідомлень про помилки
 */
function clearErrors() {
  titleError.textContent = '';
  subjectError.textContent = '';
  contentError.textContent = '';

  titleInput.parentElement.classList.remove('has-error');
  subjectInput.parentElement.classList.remove('has-error');
  contentInput.parentElement.classList.remove('has-error');

  titleInput.removeAttribute('aria-invalid');
  subjectInput.removeAttribute('aria-invalid');
  contentInput.removeAttribute('aria-invalid');
}

/**
 * Валідація форми
 * @returns {boolean} true, якщо форма валідна
 */
function validateForm() {
  clearErrors();
  let isValid = true;

  const titleVal = titleInput.value.trim();
  const subjectVal = subjectInput.value.trim();
  const contentVal = contentInput.value.trim();

  if (!titleVal) {
    titleError.textContent = 'Будь ласка, вкажіть заголовок нотатки.';
    titleInput.parentElement.classList.add('has-error');
    titleInput.setAttribute('aria-invalid', 'true');
    isValid = false;
  }

  if (!subjectVal) {
    subjectError.textContent = 'Будь ласка, вкажіть предмет або категорію.';
    subjectInput.parentElement.classList.add('has-error');
    subjectInput.setAttribute('aria-invalid', 'true');
    isValid = false;
  }

  if (!contentVal) {
    contentError.textContent = 'Зміст нотатки не може бути порожнім.';
    contentInput.parentElement.classList.add('has-error');
    contentInput.setAttribute('aria-invalid', 'true');
    isValid = false;
  }

  return isValid;
}

/**
 * Обробка рядка тегів (розбиття за комою, очищення від пробілів та порожніх елементів)
 * @param {string} rawTags 
 * @returns {Array<string>}
 */
function parseTags(rawTags) {
  if (!rawTags) return [];
  const tags = rawTags
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);
  
  // Видалення дублікатів зі збереженням регістру
  return Array.from(new Set(tags));
}

/**
 * Створення DOM-елемента для однієї нотатки (безпечно від XSS через textContent)
 * @param {Object} note 
 * @returns {HTMLElement}
 */
function createNoteElement(note) {
  const article = document.createElement('article');
  article.className = 'note-item';
  article.dataset.id = note.id;

  // Шапка нотатки
  const header = document.createElement('div');
  header.className = 'note-item-header';

  const title = document.createElement('h3');
  title.className = 'note-title';
  title.textContent = note.title;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Видалити';
  deleteBtn.setAttribute('aria-label', `Видалити нотатку "${note.title}"`);
  deleteBtn.addEventListener('click', () => deleteNote(note.id));

  header.appendChild(title);
  header.appendChild(deleteBtn);

  // Метадані (предмет, дата)
  const meta = document.createElement('div');
  meta.className = 'note-meta';

  const subjectBadge = document.createElement('span');
  subjectBadge.className = 'subject-badge';
  subjectBadge.textContent = note.subject;

  const dateSpan = document.createElement('time');
  dateSpan.dateTime = note.createdAt;
  dateSpan.textContent = formatDate(note.createdAt);

  meta.appendChild(subjectBadge);
  meta.appendChild(document.createTextNode(' • '));
  meta.appendChild(dateSpan);

  // Зміст нотатки
  const content = document.createElement('div');
  content.className = 'note-content';
  content.textContent = note.content;

  article.appendChild(header);
  article.appendChild(meta);
  article.appendChild(content);

  // Теги (якщо є)
  if (note.tags && note.tags.length > 0) {
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'note-tags';

    note.tags.forEach(tag => {
      const tagSpan = document.createElement('span');
      tagSpan.className = 'tag-badge';
      tagSpan.textContent = `#${tag}`;
      tagsContainer.appendChild(tagSpan);
    });

    article.appendChild(tagsContainer);
  }

  return article;
}

/**
 * Рендеринг списку нотаток на сторінці
 */
function renderNotes() {
  const notes = getNotesFromStorage();
  notesCount.textContent = notes.length;

  // Очищення поточного списку
  notesList.innerHTML = '';

  if (notes.length === 0) {
    emptyState.style.display = 'block';
    notesList.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    notesList.style.display = 'flex';

    // Відображаємо найновіші нотатки зверху
    notes.forEach(note => {
      const el = createNoteElement(note);
      notesList.appendChild(el);
    });
  }
}

/**
 * Видалення нотатки за її ID
 * @param {string} noteId 
 */
function deleteNote(noteId) {
  const notes = getNotesFromStorage();
  const noteToDelete = notes.find(n => n.id === noteId);
  const title = noteToDelete ? `"${noteToDelete.title}"` : 'цю нотатку';

  if (confirm(`Ви впевнені, що хочете видалити ${title}?`)) {
    const updatedNotes = notes.filter(n => n.id !== noteId);
    saveNotesToStorage(updatedNotes);
    renderNotes();
  }
}

/**
 * Обробка відправки форми
 * @param {Event} event 
 */
function handleFormSubmit(event) {
  event.preventDefault();

  if (!validateForm()) {
    return;
  }

  const newNote = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    title: titleInput.value.trim(),
    subject: subjectInput.value.trim(),
    tags: parseTags(tagsInput.value),
    content: contentInput.value.trim(),
    createdAt: new Date().toISOString()
  };

  const notes = getNotesFromStorage();
  // Додаємо на початок списку
  notes.unshift(newNote);
  saveNotesToStorage(notes);

  // Очищення форми
  form.reset();
  clearErrors();

  // Оновлення списку
  renderNotes();

  // Фокус назад на перше поле для швидкого наступного вводу
  titleInput.focus();
}

// Слухачі подій
form.addEventListener('submit', handleFormSubmit);

form.addEventListener('reset', () => {
  setTimeout(clearErrors, 0);
});

// Очищення помилок при введенні даних
[titleInput, subjectInput, contentInput].forEach(input => {
  input.addEventListener('input', () => {
    if (input.value.trim().length > 0) {
      input.parentElement.classList.remove('has-error');
      input.removeAttribute('aria-invalid');
      const errElem = document.getElementById(input.name + '-error') || 
                      document.getElementById(input.id.replace('note-', '') + '-error');
      if (errElem) errElem.textContent = '';
    }
  });
});

// Ініціалізація під час завантаження сторінки
document.addEventListener('DOMContentLoaded', () => {
  renderNotes();
});
