const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/finance.db');

db.serialize(() => {
  // Создаём таблицу categories, если её нет
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      user_id INTEGER,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы:', err);
    else console.log('✅ Таблица categories готова');
  });

  // Добавляем категории по умолчанию (игнорируем дубликаты)
  const stmt = db.prepare('INSERT OR IGNORE INTO categories (name, type, is_default) VALUES (?, ?, ?)');
  const categories = [
    ['Зарплата', 'income', 1],
    ['Фриланс', 'income', 1],
    ['Подарки', 'income', 1],
    ['Инвестиции', 'income', 1],
    ['Другое (доход)', 'income', 1],
    ['Продукты', 'expense', 1],
    ['Транспорт', 'expense', 1],
    ['Рестораны', 'expense', 1],
    ['Жильё', 'expense', 1],
    ['Развлечения', 'expense', 1],
    ['Здоровье', 'expense', 1],
    ['Одежда', 'expense', 1],
    ['Связь', 'expense', 1],
    ['Образование', 'expense', 1],
    ['Другое (расход)', 'expense', 1]
  ];
  categories.forEach(cat => stmt.run(cat));
  stmt.finalize();
});

setTimeout(() => db.close(), 1000);
console.log('Скрипт инициализации категорий выполнен');