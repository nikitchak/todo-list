/**
 * Автотесты логики списка задач.
 * Запуск: node --test  (Node.js 20+, без установки зависимостей)
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../todo-core.js');

/** Короткий способ создать задачу с нужным id. */
function make(text, id, extra = {}) {
  const result = Core.createTask(text, { id, now: 1, ...extra });
  assert.ok(result.ok, `не удалось создать задачу "${text}"`);
  return result.task;
}

/** Хранилище в памяти — замена localStorage в тестах. */
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    data,
  };
}

describe('Добавление задач', () => {
  test('создаёт задачу с текстом и значениями по умолчанию', () => {
    const { ok, task } = Core.createTask('Купить молоко');
    assert.equal(ok, true);
    assert.equal(task.text, 'Купить молоко');
    assert.equal(task.done, false);
    assert.equal(task.priority, 'medium');
    assert.equal(task.due, null);
    assert.equal(typeof task.id, 'string');
  });

  test('обрезает пробелы по краям и схлопывает лишние внутри', () => {
    const { task } = Core.createTask('   Позвонить    маме   ');
    assert.equal(task.text, 'Позвонить маме');
  });

  test('не создаёт пустую задачу и задачу из одних пробелов', () => {
    assert.deepEqual(Core.createTask(''), { ok: false, error: 'empty' });
    assert.deepEqual(Core.createTask('    '), { ok: false, error: 'empty' });
    assert.deepEqual(Core.createTask(undefined), { ok: false, error: 'empty' });
  });

  test('ограничивает длину текста', () => {
    const max = 'а'.repeat(Core.MAX_TEXT_LENGTH);
    assert.equal(Core.createTask(max).ok, true);
    assert.deepEqual(Core.createTask(max + 'а'), { ok: false, error: 'too-long' });
  });

  test('принимает приоритет и срок, некорректные значения заменяет', () => {
    assert.equal(Core.createTask('A', { priority: 'high' }).task.priority, 'high');
    assert.equal(Core.createTask('A', { priority: 'urgent' }).task.priority, 'medium');
    assert.equal(Core.createTask('A', { due: '2026-12-31' }).task.due, '2026-12-31');
    assert.equal(Core.createTask('A', { due: '2026-02-30' }).task.due, null);
    assert.equal(Core.createTask('A', { due: 'завтра' }).task.due, null);
  });

  test('генерирует уникальные id', () => {
    const ids = new Set(Array.from({ length: 500 }, () => Core.createTask('x').task.id));
    assert.equal(ids.size, 500);
  });

  test('новая задача добавляется в начало, исходный список не меняется', () => {
    const tasks = [make('Старая', 'a')];
    const result = Core.addTask(tasks, make('Новая', 'b'));
    assert.deepEqual(result.map((t) => t.id), ['b', 'a']);
    assert.equal(tasks.length, 1);
  });
});

describe('Отметка выполненных', () => {
  test('переключает отметку туда и обратно', () => {
    const tasks = [make('A', 'a'), make('B', 'b')];
    const once = Core.toggleTask(tasks, 'a');
    assert.equal(once[0].done, true);
    assert.equal(once[1].done, false);
    assert.equal(Core.toggleTask(once, 'a')[0].done, false);
    assert.equal(tasks[0].done, false, 'исходный массив не изменился');
  });

  test('несуществующий id ничего не ломает', () => {
    const tasks = [make('A', 'a')];
    assert.deepEqual(Core.toggleTask(tasks, 'nope'), tasks);
  });
});

describe('Удаление и отмена удаления', () => {
  test('удаляет задачу и возвращает её позицию', () => {
    const tasks = [make('A', 'a'), make('B', 'b'), make('C', 'c')];
    const { tasks: rest, removed, index } = Core.removeTask(tasks, 'b');
    assert.deepEqual(rest.map((t) => t.id), ['a', 'c']);
    assert.equal(removed.id, 'b');
    assert.equal(index, 1);
  });

  test('отмена возвращает задачу на прежнее место', () => {
    const tasks = [make('A', 'a'), make('B', 'b'), make('C', 'c')];
    const { tasks: rest, removed, index } = Core.removeTask(tasks, 'b');
    assert.deepEqual(Core.restoreTask(rest, removed, index).map((t) => t.id), ['a', 'b', 'c']);
  });

  test('повторная отмена не создаёт дубликат', () => {
    const tasks = [make('A', 'a')];
    assert.equal(Core.restoreTask(tasks, tasks[0], 0).length, 1);
  });

  test('удаление несуществующей задачи ничего не меняет', () => {
    const tasks = [make('A', 'a')];
    const result = Core.removeTask(tasks, 'nope');
    assert.equal(result.removed, null);
    assert.equal(result.tasks, tasks);
  });

  test('очистка выполненных оставляет только активные', () => {
    let tasks = [make('A', 'a'), make('B', 'b'), make('C', 'c')];
    tasks = Core.toggleTask(Core.toggleTask(tasks, 'a'), 'c');
    assert.deepEqual(Core.clearCompleted(tasks).map((t) => t.id), ['b']);
  });
});

describe('Редактирование и порядок', () => {
  test('меняет текст задачи', () => {
    const result = Core.updateTaskText([make('A', 'a')], 'a', '  Новый текст ');
    assert.equal(result.ok, true);
    assert.equal(result.tasks[0].text, 'Новый текст');
  });

  test('пустой текст при редактировании не сохраняется', () => {
    const tasks = [make('A', 'a')];
    const result = Core.updateTaskText(tasks, 'a', '   ');
    assert.equal(result.ok, false);
    assert.equal(result.tasks[0].text, 'A');
  });

  test('переносит задачу на новую позицию', () => {
    const tasks = [make('A', 'a'), make('B', 'b'), make('C', 'c')];
    assert.deepEqual(Core.moveTask(tasks, 'a', 2).map((t) => t.id), ['b', 'c', 'a']);
    assert.deepEqual(Core.moveTask(tasks, 'c', 0).map((t) => t.id), ['c', 'a', 'b']);
    assert.deepEqual(Core.moveTask(tasks, 'a', 99).map((t) => t.id), ['b', 'c', 'a']);
  });

  test('расставляет задачи по порядку id после перетаскивания', () => {
    const tasks = [make('A', 'a'), make('B', 'b'), make('C', 'c')];
    assert.deepEqual(Core.reorderTasks(tasks, ['c', 'a']).map((t) => t.id), ['c', 'a', 'b']);
  });
});

describe('Фильтры, поиск и счётчики', () => {
  const tasks = Core.toggleTask(
    [make('Купить молоко', 'a'), make('Позвонить маме', 'b'), make('Купить хлеб', 'c')],
    'c'
  );

  test('фильтрует по статусу', () => {
    assert.equal(Core.filterTasks(tasks, 'all').length, 3);
    assert.deepEqual(Core.filterTasks(tasks, 'active').map((t) => t.id), ['a', 'b']);
    assert.deepEqual(Core.filterTasks(tasks, 'done').map((t) => t.id), ['c']);
  });

  test('ищет без учёта регистра и вместе с фильтром', () => {
    assert.deepEqual(Core.filterTasks(tasks, 'all', 'КУПИТЬ').map((t) => t.id), ['a', 'c']);
    assert.deepEqual(Core.filterTasks(tasks, 'active', 'купить').map((t) => t.id), ['a']);
    assert.equal(Core.filterTasks(tasks, 'all', 'нет такого').length, 0);
  });

  test('считает статистику', () => {
    assert.deepEqual(Core.getStats(tasks), { total: 3, done: 1, active: 2, percent: 33 });
    assert.deepEqual(Core.getStats([]), { total: 0, done: 0, active: 0, percent: 0 });
  });

  test('склоняет слова по числу', () => {
    const forms = ['задача', 'задачи', 'задач'];
    const cases = { 0: 'задач', 1: 'задача', 2: 'задачи', 4: 'задачи', 5: 'задач', 11: 'задач', 14: 'задач', 21: 'задача', 22: 'задачи', 111: 'задач' };
    Object.entries(cases).forEach(([n, expected]) => {
      assert.equal(Core.pluralize(Number(n), forms), expected, `для ${n}`);
    });
  });
});

describe('Сроки', () => {
  const today = '2026-11-08';

  test('определяет статус срока', () => {
    assert.equal(Core.getDueStatus(make('A', 'a'), today), null);
    assert.equal(Core.getDueStatus(make('A', 'a', { due: '2026-11-07' }), today), 'overdue');
    assert.equal(Core.getDueStatus(make('A', 'a', { due: '2026-11-08' }), today), 'today');
    assert.equal(Core.getDueStatus(make('A', 'a', { due: '2026-11-09' }), today), 'tomorrow');
    assert.equal(Core.getDueStatus(make('A', 'a', { due: '2026-12-01' }), today), 'upcoming');
  });

  test('выполненная задача не считается просроченной', () => {
    const task = { ...make('A', 'a', { due: '2026-01-01' }), done: true };
    assert.equal(Core.getDueStatus(task, today), 'done');
  });

  test('корректно переходит через конец месяца и года', () => {
    assert.equal(Core.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(Core.addDays('2028-02-28', 1), '2028-02-29');
  });
});

describe('Сохранение после перезагрузки', () => {
  const KEY = 'todo-list.tasks.v1';

  test('сохранённые задачи загружаются без изменений', () => {
    const storage = memoryStorage();
    const tasks = Core.toggleTask([make('A', 'a', { priority: 'high', due: '2026-11-20' }), make('B', 'b')], 'b');
    assert.equal(Core.saveTasks(storage, KEY, tasks), true);
    assert.deepEqual(Core.loadTasks(storage, KEY), tasks);
  });

  test('пустое хранилище — пустой список', () => {
    assert.deepEqual(Core.loadTasks(memoryStorage(), KEY), []);
  });

  test('повреждённые данные не ломают приложение', () => {
    assert.deepEqual(Core.loadTasks(memoryStorage({ [KEY]: '{не json' }), KEY), []);
    assert.deepEqual(Core.loadTasks(memoryStorage({ [KEY]: '{"a":1}' }), KEY), []);
  });

  test('битые записи и дубликаты отбрасываются, остальные сохраняются', () => {
    const raw = JSON.stringify([
      { id: 'a', text: 'Нормальная', done: true },
      { id: 'b', text: '   ' },
      { text: 'Без id' },
      null,
      { id: 'a', text: 'Дубликат' },
      { id: 'c', text: 'Странные поля', priority: 'urgent', due: 'вчера', done: 'yes' },
    ]);
    const tasks = Core.loadTasks(memoryStorage({ [KEY]: raw }), KEY);
    assert.deepEqual(tasks.map((t) => t.id), ['a', 'c']);
    assert.equal(tasks[1].priority, 'medium');
    assert.equal(tasks[1].due, null);
    assert.equal(tasks[1].done, false);
  });

  test('ошибка хранилища не роняет приложение', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    assert.deepEqual(Core.loadTasks(broken, KEY), []);
    assert.equal(Core.saveTasks(broken, KEY, []), false);
  });
});
