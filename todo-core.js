/**
 * Логика списка задач без привязки к странице (DOM).
 *
 * Все функции «чистые»: не меняют входной массив, а возвращают новый.
 * Благодаря этому логику легко покрыть автотестами.
 *
 * Модуль работает и в браузере (window.TodoCore), и в Node.js (require) — для тестов.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodoCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_TEXT_LENGTH = 200;
  const PRIORITIES = ['low', 'medium', 'high'];
  const DEFAULT_PRIORITY = 'medium';
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  // ---------- Проверка входных данных ----------

  /** Убирает пробелы по краям и схлопывает повторяющиеся пробелы внутри. */
  function normalizeText(text) {
    return typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '';
  }

  /** Проверяет текст задачи. Возвращает { ok, value } или { ok: false, error }. */
  function validateText(text) {
    const value = normalizeText(text);
    if (!value) return { ok: false, error: 'empty' };
    if (value.length > MAX_TEXT_LENGTH) return { ok: false, error: 'too-long' };
    return { ok: true, value };
  }

  /** Проверяет дату в формате ГГГГ-ММ-ДД (как отдаёт <input type="date">). */
  function isValidDate(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  // ---------- Создание и изменение задач ----------

  let idCounter = 0;

  /** Уникальный id: время + счётчик + случайная часть. */
  function generateId() {
    idCounter += 1;
    return [
      Date.now().toString(36),
      idCounter.toString(36),
      Math.random().toString(36).slice(2, 7),
    ].join('-');
  }

  /**
   * Создаёт задачу. Возвращает { ok: true, task } или { ok: false, error }.
   * options: { priority, due, id, now }
   */
  function createTask(text, options = {}) {
    const check = validateText(text);
    if (!check.ok) return { ok: false, error: check.error };

    return {
      ok: true,
      task: {
        id: options.id || generateId(),
        text: check.value,
        done: false,
        priority: PRIORITIES.includes(options.priority) ? options.priority : DEFAULT_PRIORITY,
        due: isValidDate(options.due) ? options.due : null,
        createdAt: Number.isFinite(options.now) ? options.now : Date.now(),
      },
    };
  }

  /** Добавляет задачу в начало списка. */
  function addTask(tasks, task) {
    return [task, ...tasks];
  }

  /** Переключает отметку «выполнено». */
  function toggleTask(tasks, id) {
    return tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task));
  }

  /** Удаляет задачу. Возвращает новый список, удалённую задачу и её позицию (для отмены). */
  function removeTask(tasks, id) {
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) return { tasks, removed: null, index: -1 };
    return {
      tasks: [...tasks.slice(0, index), ...tasks.slice(index + 1)],
      removed: tasks[index],
      index,
    };
  }

  /** Возвращает удалённую задачу на прежнее место (отмена удаления). */
  function restoreTask(tasks, task, index) {
    if (!task || tasks.some((item) => item.id === task.id)) return tasks;
    const position = Math.max(0, Math.min(index, tasks.length));
    return [...tasks.slice(0, position), task, ...tasks.slice(position)];
  }

  /** Меняет текст задачи. Пустой текст не сохраняется. */
  function updateTaskText(tasks, id, text) {
    const check = validateText(text);
    if (!check.ok) return { ok: false, error: check.error, tasks };
    return {
      ok: true,
      tasks: tasks.map((task) => (task.id === id ? { ...task, text: check.value } : task)),
    };
  }

  /** Убирает все выполненные задачи. */
  function clearCompleted(tasks) {
    return tasks.filter((task) => !task.done);
  }

  /** Переносит задачу на новую позицию. */
  function moveTask(tasks, id, toIndex) {
    const from = tasks.findIndex((task) => task.id === id);
    if (from === -1) return tasks;
    const to = Math.max(0, Math.min(toIndex, tasks.length - 1));
    if (from === to) return tasks;
    const copy = tasks.slice();
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    return copy;
  }

  /** Расставляет задачи в порядке переданных id (после перетаскивания). */
  function reorderTasks(tasks, orderedIds) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const result = [];
    orderedIds.forEach((id) => {
      if (byId.has(id)) {
        result.push(byId.get(id));
        byId.delete(id);
      }
    });
    // Задачи, которых не было в переданном порядке, остаются в конце.
    tasks.forEach((task) => {
      if (byId.has(task.id)) result.push(task);
    });
    return result;
  }

  // ---------- Выборки и подсчёты ----------

  /** Фильтр: 'all' | 'active' | 'done' + поиск по тексту без учёта регистра. */
  function filterTasks(tasks, filter = 'all', query = '') {
    const needle = normalizeText(query).toLowerCase();
    return tasks.filter((task) => {
      if (filter === 'active' && task.done) return false;
      if (filter === 'done' && !task.done) return false;
      if (needle && !task.text.toLowerCase().includes(needle)) return false;
      return true;
    });
  }

  function getStats(tasks) {
    const done = tasks.filter((task) => task.done).length;
    return {
      total: tasks.length,
      done,
      active: tasks.length - done,
      percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    };
  }

  // ---------- Даты ----------

  /** Дата в формате ГГГГ-ММ-ДД по местному времени. */
  function toDateKey(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function addDays(dateKey, days) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return toDateKey(new Date(year, month - 1, day + days));
  }

  /** Статус срока: null | 'done' | 'overdue' | 'today' | 'tomorrow' | 'upcoming'. */
  function getDueStatus(task, todayKey = toDateKey(new Date())) {
    if (!task.due) return null;
    if (task.done) return 'done';
    if (task.due < todayKey) return 'overdue';
    if (task.due === todayKey) return 'today';
    if (task.due === addDays(todayKey, 1)) return 'tomorrow';
    return 'upcoming';
  }

  // ---------- Русские окончания ----------

  /** pluralize(5, ['задача', 'задачи', 'задач']) → 'задач' */
  function pluralize(count, forms) {
    const mod100 = Math.abs(count) % 100;
    const mod10 = mod100 % 10;
    if (mod100 > 10 && mod100 < 20) return forms[2];
    if (mod10 > 1 && mod10 < 5) return forms[1];
    if (mod10 === 1) return forms[0];
    return forms[2];
  }

  // ---------- Сохранение ----------

  /** Проверяет задачу из хранилища. Битые записи отбрасываются. */
  function sanitizeTask(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    const check = validateText(raw.text);
    if (!check.ok) return null;
    return {
      id: raw.id,
      text: check.value,
      done: raw.done === true,
      priority: PRIORITIES.includes(raw.priority) ? raw.priority : DEFAULT_PRIORITY,
      due: isValidDate(raw.due) ? raw.due : null,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    };
  }

  /** Разбирает JSON из хранилища. При любой ошибке — пустой список, а не падение. */
  function parseTasks(json) {
    if (typeof json !== 'string' || !json) return [];
    let data;
    try {
      data = JSON.parse(json);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(data)) return [];

    const seen = new Set();
    const result = [];
    data.forEach((raw) => {
      const task = sanitizeTask(raw);
      if (task && !seen.has(task.id)) {
        seen.add(task.id);
        result.push(task);
      }
    });
    return result;
  }

  function loadTasks(storage, key) {
    try {
      return parseTasks(storage.getItem(key));
    } catch (error) {
      return [];
    }
  }

  /** Сохраняет задачи. Возвращает false, если хранилище недоступно или переполнено. */
  function saveTasks(storage, key, tasks) {
    try {
      storage.setItem(key, JSON.stringify(tasks));
      return true;
    } catch (error) {
      return false;
    }
  }

  return {
    MAX_TEXT_LENGTH,
    PRIORITIES,
    DEFAULT_PRIORITY,
    normalizeText,
    validateText,
    isValidDate,
    createTask,
    addTask,
    toggleTask,
    removeTask,
    restoreTask,
    updateTaskText,
    clearCompleted,
    moveTask,
    reorderTasks,
    filterTasks,
    getStats,
    toDateKey,
    addDays,
    getDueStatus,
    pluralize,
    parseTasks,
    loadTasks,
    saveTasks,
  };
});
