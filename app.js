/**
 * Интерфейс списка задач: отрисовка и обработка действий пользователя.
 * Вся работа с данными — в todo-core.js (window.TodoCore).
 */
(function () {
  'use strict';

  const Core = window.TodoCore;

  const STORAGE_KEY = 'todo-list.tasks.v1';
  const THEME_KEY = 'todo-list.theme';
  const UNDO_TIMEOUT_MS = 5000;

  const PRIORITY_LABELS = { low: 'Низкий', medium: 'Обычный', high: 'Высокий' };

  const EMPTY_MESSAGES = {
    all: 'Задач пока нет. Напишите первую в поле выше.',
    active: 'Активных задач нет. Всё выполнено!',
    done: 'Выполненных задач пока нет.',
  };

  const FORM_ERRORS = {
    empty: 'Введите текст задачи.',
    'too-long': `Текст задачи не длиннее ${Core.MAX_TEXT_LENGTH} символов.`,
  };

  // ---------- Хранилище ----------

  /** localStorage может быть недоступен (например, в приватном режиме). */
  function getStorage() {
    try {
      const storage = window.localStorage;
      const probe = '__todo_probe__';
      storage.setItem(probe, probe);
      storage.removeItem(probe);
      return storage;
    } catch (error) {
      return null;
    }
  }

  const storage = getStorage();

  // ---------- Состояние ----------

  const state = {
    tasks: storage ? Core.loadTasks(storage, STORAGE_KEY) : [],
    filter: 'all',
    query: '',
    editingId: null,
    justAddedId: null,
  };

  /** DOM-узлы задач по id: при перерисовке узлы обновляются, а не создаются заново. */
  const nodes = new Map();

  // ---------- Элементы страницы ----------

  const byId = (id) => document.getElementById(id);
  const els = {
    form: byId('add-form'),
    input: byId('new-task'),
    due: byId('new-due'),
    formError: byId('form-error'),
    list: byId('task-list'),
    empty: byId('empty-state'),
    template: byId('task-template'),
    progressBar: byId('progress-bar'),
    progressFill: byId('progress-fill'),
    progressText: byId('progress-text'),
    remaining: byId('remaining'),
    clearCompleted: byId('clear-completed'),
    listFooter: byId('list-footer'),
    search: byId('search'),
    filters: document.querySelectorAll('[data-filter]'),
    counts: document.querySelectorAll('[data-count]'),
    today: byId('today'),
    themeToggle: byId('theme-toggle'),
    storageWarning: byId('storage-warning'),
    toast: byId('toast'),
    toastText: byId('toast-text'),
    toastUndo: byId('toast-undo'),
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

  // ---------- Сохранение ----------

  function persist() {
    if (!storage) return;
    if (!Core.saveTasks(storage, STORAGE_KEY, state.tasks)) {
      showStorageWarning('Не удалось сохранить задачи: хранилище браузера переполнено или недоступно.');
    }
  }

  function showStorageWarning(message) {
    els.storageWarning.textContent = message;
    els.storageWarning.hidden = false;
  }

  // ---------- Отрисовка ----------

  const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  const dayMonthYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

  function formatDue(due, status, todayKey) {
    const [year, month, day] = due.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const label = (String(year) === todayKey.slice(0, 4) ? dayMonth : dayMonthYear).format(date);
    switch (status) {
      case 'today':
        return 'Срок: сегодня';
      case 'tomorrow':
        return 'Срок: завтра';
      case 'overdue':
        return `Просрочено: ${label}`;
      default:
        return `Срок: ${label}`;
    }
  }

  function createTaskElement(id) {
    const li = els.template.content.firstElementChild.cloneNode(true);
    li.dataset.id = id;
    li.addEventListener('animationend', (event) => {
      if (event.animationName === 'task-in') li.classList.remove('is-entering');
    });
    return li;
  }

  function updateTaskElement(li, task, todayKey) {
    li.dataset.priority = task.priority;
    li.classList.toggle('is-done', task.done);

    const toggle = li.querySelector('.task-toggle');
    toggle.checked = task.done;
    toggle.setAttribute('aria-label', `Выполнено: ${task.text}`);

    // Текст задачи вставляется только как текст (textContent), не как HTML.
    const textEl = li.querySelector('.task-text');
    if (!li.classList.contains('is-editing') && textEl.textContent !== task.text) {
      textEl.textContent = task.text;
    }

    li.querySelector('.task-priority').textContent = PRIORITY_LABELS[task.priority];

    const dueEl = li.querySelector('.task-due');
    const status = Core.getDueStatus(task, todayKey);
    dueEl.hidden = !task.due;
    dueEl.dataset.status = status || '';
    dueEl.textContent = task.due ? formatDue(task.due, status, todayKey) : '';

    li.querySelector('.task-edit').setAttribute('aria-label', `Редактировать: ${task.text}`);
    li.querySelector('.task-delete').setAttribute('aria-label', `Удалить: ${task.text}`);
    li.querySelector('.task-handle').setAttribute(
      'aria-label',
      `Переместить: ${task.text}. Используйте стрелки вверх и вниз`
    );
  }

  // Защита от повторного входа: удаление или перенос узла может вызвать blur,
  // а обработчик blur снова вызывает render().
  let isRendering = false;
  let renderQueued = false;

  function render() {
    if (isRendering) {
      renderQueued = true;
      return;
    }
    isRendering = true;
    try {
      renderNow();
    } finally {
      isRendering = false;
    }
    if (renderQueued) {
      renderQueued = false;
      render();
    }
  }

  function renderNow() {
    const todayKey = Core.toDateKey(new Date());
    const visible = Core.filterTasks(state.tasks, state.filter, state.query);

    // Менять порядок можно, только когда видны все задачи.
    const reorderable = state.filter === 'all' && !Core.normalizeText(state.query) && state.tasks.length > 1;
    els.list.classList.toggle('is-reorderable', reorderable);

    const seen = new Set();
    visible.forEach((task, index) => {
      let li = nodes.get(task.id);
      if (!li) {
        li = createTaskElement(task.id);
        nodes.set(task.id, li);
        if (task.id === state.justAddedId && !reducedMotion.matches) li.classList.add('is-entering');
      }
      updateTaskElement(li, task, todayKey);
      li.draggable = reorderable && !li.classList.contains('is-editing');
      const current = els.list.children[index];
      if (current !== li) els.list.insertBefore(li, current || null);
      seen.add(task.id);
    });

    nodes.forEach((li, id) => {
      if (!seen.has(id)) {
        // Редактируемая задача исчезла (например, удалена в другой вкладке):
        // сбрасываем редактирование до удаления узла.
        if (state.editingId === id) state.editingId = null;
        nodes.delete(id);
        li.remove();
      }
    });

    state.justAddedId = null;
    renderSummary(visible.length);
  }

  function renderSummary(visibleCount) {
    const stats = Core.getStats(state.tasks);

    els.progressFill.style.width = `${stats.percent}%`;
    els.progressBar.setAttribute('aria-valuenow', String(stats.percent));
    if (!stats.total) {
      els.progressText.textContent = 'Задач пока нет';
    } else if (stats.done === stats.total) {
      els.progressText.textContent = `Всё выполнено: ${stats.done} из ${stats.total}`;
    } else {
      els.progressText.textContent = `Выполнено ${stats.done} из ${stats.total}`;
    }

    const counts = { all: stats.total, active: stats.active, done: stats.done };
    els.counts.forEach((el) => {
      el.textContent = String(counts[el.dataset.count]);
    });

    els.list.hidden = visibleCount === 0;
    els.empty.hidden = visibleCount !== 0;
    if (visibleCount === 0) {
      const query = Core.normalizeText(state.query);
      if (query) {
        els.empty.textContent = `Ничего не найдено по запросу «${query}».`;
      } else {
        els.empty.textContent = stats.total === 0 ? EMPTY_MESSAGES.all : EMPTY_MESSAGES[state.filter];
      }
    }

    els.listFooter.hidden = stats.total === 0;
    els.remaining.textContent =
      stats.active === 0
        ? 'Все задачи выполнены'
        : `${Core.pluralize(stats.active, ['Осталась', 'Осталось', 'Осталось'])} ${stats.active} ` +
          Core.pluralize(stats.active, ['задача', 'задачи', 'задач']);
    els.clearCompleted.disabled = stats.done === 0;
  }

  /** Ставит фокус на элемент задачи; если её нет — на поле ввода. */
  function focusTask(id, selector) {
    const li = id && nodes.get(id);
    if (li && li.isConnected) {
      li.querySelector(selector).focus();
    } else {
      els.input.focus();
    }
  }

  /**
   * Фокус внутри элемента и пользователь работает с клавиатуры?
   * Для мыши и пальца фокус не переносим: иначе на телефоне выскочит клавиатура.
   */
  function hasKeyboardFocus(container) {
    const active = document.activeElement;
    if (!active || !container.contains(active)) return false;
    try {
      return active.matches(':focus-visible');
    } catch (error) {
      return true;
    }
  }

  function neighborId(li) {
    const neighbor = li.nextElementSibling || li.previousElementSibling;
    return neighbor ? neighbor.dataset.id : null;
  }

  /** Анимация исчезновения; без анимации, если пользователь их отключил. */
  function animateOut(li, done) {
    if (reducedMotion.matches) {
      done();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    li.classList.add('is-leaving');
    li.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 320);
  }

  // ---------- Уведомление с отменой ----------

  let toastTimer = null;
  let undoAction = null;

  function showUndo(message, onUndo) {
    clearTimeout(toastTimer);
    els.toastText.textContent = message;
    undoAction = onUndo;
    els.toast.hidden = false;
    toastTimer = setTimeout(hideToast, UNDO_TIMEOUT_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    els.toast.hidden = true;
    undoAction = null;
  }

  els.toastUndo.addEventListener('click', () => {
    const action = undoAction;
    hideToast();
    if (action) action();
  });

  // ---------- Добавление ----------

  function setFormError(message) {
    els.formError.textContent = message;
    els.input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();

    const result = Core.createTask(els.input.value, {
      priority: els.form.elements.priority.value,
      due: els.due.value || null,
    });

    if (!result.ok) {
      setFormError(FORM_ERRORS[result.error]);
      els.input.focus();
      return;
    }

    // Если новая задача не попадёт в текущий фильтр, показываем все.
    if (!Core.filterTasks([result.task], state.filter, state.query).length) {
      els.search.value = '';
      state.query = '';
      setFilter('all', false);
    }

    state.tasks = Core.addTask(state.tasks, result.task);
    state.justAddedId = result.task.id;
    persist();
    render();

    els.form.reset();
    setFormError('');
    els.input.focus();
  });

  els.input.addEventListener('input', () => {
    if (els.formError.textContent) setFormError('');
  });

  // ---------- Действия с задачами ----------

  function deleteTask(id) {
    const li = nodes.get(id);
    if (!li || li.classList.contains('is-leaving')) return;

    const nextId = neighborId(li);
    const hadFocus = hasKeyboardFocus(li);

    animateOut(li, () => {
      const result = Core.removeTask(state.tasks, id);
      if (!result.removed) return;
      if (state.editingId === id) state.editingId = null;

      state.tasks = result.tasks;
      persist();
      render();
      if (hadFocus) focusTask(nextId, '.task-delete');

      showUndo('Задача удалена', () => {
        state.tasks = Core.restoreTask(state.tasks, result.removed, result.index);
        state.justAddedId = result.removed.id;
        persist();
        render();
      });
    });
  }

  function toggleTask(id) {
    const li = nodes.get(id);
    const nextId = li ? neighborId(li) : null;
    const hadFocus = li ? hasKeyboardFocus(li) : false;

    state.tasks = Core.toggleTask(state.tasks, id);
    persist();
    render();

    // Если задача скрылась фильтром, переводим фокус на соседнюю.
    if (hadFocus && !li.isConnected) focusTask(nextId, '.task-toggle');
  }

  function startEditing(id) {
    if (state.editingId) finishEditing(true, false);

    const li = nodes.get(id);
    const task = state.tasks.find((item) => item.id === id);
    if (!li || !task) return;

    state.editingId = id;
    li.classList.add('is-editing');
    li.draggable = false;

    const textEl = li.querySelector('.task-text');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = task.text;
    input.maxLength = Core.MAX_TEXT_LENGTH;
    input.setAttribute('aria-label', 'Текст задачи');

    textEl.hidden = true;
    textEl.parentNode.insertBefore(input, textEl);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finishEditing(true, true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finishEditing(false, true);
      }
    });
    input.addEventListener('blur', () => finishEditing(true, false));
  }

  /** save — сохранить изменения; returnFocus — вернуть фокус на кнопку «Редактировать». */
  function finishEditing(save, returnFocus) {
    const id = state.editingId;
    if (!id) return;
    state.editingId = null;

    const li = nodes.get(id);
    const input = li && li.querySelector('.task-edit-input');

    if (save && input) {
      // Пустой текст не сохраняем — остаётся прежний.
      const result = Core.updateTaskText(state.tasks, id, input.value);
      if (result.ok) {
        state.tasks = result.tasks;
        persist();
      }
    }

    if (li) {
      li.classList.remove('is-editing');
      li.querySelector('.task-text').hidden = false;
      if (input) input.remove();
    }

    render();
    if (returnFocus) focusTask(id, '.task-edit');
  }

  els.list.addEventListener('change', (event) => {
    if (!event.target.matches('.task-toggle')) return;
    toggleTask(event.target.closest('.task').dataset.id);
  });

  els.list.addEventListener('click', (event) => {
    const li = event.target.closest('.task');
    if (!li) return;
    if (event.target.closest('.task-delete')) {
      deleteTask(li.dataset.id);
    } else if (event.target.closest('.task-edit')) {
      startEditing(li.dataset.id);
    }
  });

  els.list.addEventListener('dblclick', (event) => {
    const textEl = event.target.closest('.task-text');
    if (!textEl) return;
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    startEditing(textEl.closest('.task').dataset.id);
  });

  els.clearCompleted.addEventListener('click', () => {
    const removed = [];
    state.tasks.forEach((task, index) => {
      if (task.done) removed.push({ task, index });
    });
    if (!removed.length) return;
    const hadFocus = hasKeyboardFocus(els.listFooter);

    state.tasks = Core.clearCompleted(state.tasks);
    persist();
    render();

    showUndo(`Удалено выполненных: ${removed.length}`, () => {
      removed.forEach(({ task, index }) => {
        state.tasks = Core.restoreTask(state.tasks, task, index);
      });
      persist();
      render();
    });

    // Кнопка стала неактивной — переводим фокус на «Отменить».
    if (hadFocus) els.toastUndo.focus();
  });

  // ---------- Перетаскивание ----------

  let draggingId = null;
  let pressedOnHandle = false;

  // Задачу можно тянуть только за «ручку», чтобы не мешать кликам и выделению текста.
  els.list.addEventListener('pointerdown', (event) => {
    pressedOnHandle = Boolean(event.target.closest('.task-handle'));
  });

  els.list.addEventListener('dragstart', (event) => {
    const li = event.target.closest && event.target.closest('.task');
    if (!li || !li.draggable || !pressedOnHandle) {
      event.preventDefault();
      return;
    }
    draggingId = li.dataset.id;
    li.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggingId);
  });

  els.list.addEventListener('dragover', (event) => {
    if (!draggingId) return;
    event.preventDefault();
    const dragged = nodes.get(draggingId);
    const target = event.target.closest('.task');
    if (!dragged || !target || target === dragged) return;
    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    els.list.insertBefore(dragged, after ? target.nextSibling : target);
  });

  els.list.addEventListener('drop', (event) => {
    if (draggingId) event.preventDefault();
  });

  els.list.addEventListener('dragend', () => {
    if (!draggingId) return;
    const li = nodes.get(draggingId);
    if (li) li.classList.remove('is-dragging');
    draggingId = null;
    pressedOnHandle = false;

    const orderedIds = Array.from(els.list.children, (item) => item.dataset.id);
    state.tasks = Core.reorderTasks(state.tasks, orderedIds);
    persist();
    render();
  });

  // Перемещение с клавиатуры: фокус на «ручке» + стрелки вверх/вниз.
  els.list.addEventListener('keydown', (event) => {
    const handle = event.target.closest('.task-handle');
    if (!handle || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();

    const id = handle.closest('.task').dataset.id;
    const index = state.tasks.findIndex((task) => task.id === id);
    const nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (nextIndex < 0 || nextIndex >= state.tasks.length) return;

    state.tasks = Core.moveTask(state.tasks, id, nextIndex);
    persist();
    render();
    focusTask(id, '.task-handle');
  });

  // ---------- Фильтры и поиск ----------

  function setFilter(filter, shouldRender = true) {
    state.filter = filter;
    els.filters.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    });
    if (shouldRender) render();
  }

  els.filters.forEach((button) => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    render();
  });

  function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'button', 'submit'].includes(el.type);
    return false;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target)) {
      event.preventDefault();
      els.search.focus();
      return;
    }

    if (event.key === 'Escape' && event.target === els.search) {
      event.preventDefault();
      if (els.search.value) {
        els.search.value = '';
        state.query = '';
        render();
      } else {
        els.search.blur();
      }
    }
  });

  // ---------- Тема ----------

  function currentTheme() {
    return document.documentElement.dataset.theme || (darkScheme.matches ? 'dark' : 'light');
  }

  function updateThemeButton() {
    const theme = currentTheme();
    const label = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
    els.themeToggle.dataset.current = theme;
    els.themeToggle.setAttribute('aria-label', label);
    els.themeToggle.title = label;
  }

  els.themeToggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      // Тема просто не запомнится — это не критично.
    }
    updateThemeButton();
  });

  darkScheme.addEventListener('change', updateThemeButton);

  // ---------- Синхронизация между вкладками ----------

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state.tasks = Core.parseTasks(event.newValue);
    render();
  });

  // ---------- Запуск ----------

  const todayLabel = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  els.today.textContent = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1);

  if (!storage) {
    showStorageWarning('Браузер не даёт сохранять данные, поэтому задачи пропадут после перезагрузки.');
  }

  updateThemeButton();
  render();
})();
