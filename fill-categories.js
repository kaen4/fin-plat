const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/finance.db');

db.serialize(() => {
  // Удаляем старую таблицу (если есть кривая)
  db.run('DROP TABLE IF EXISTS categories');

  // Создаём новую таблицу
  db.run(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      user_id INTEGER,
      is_default INTEGER DEFAULT 0
    )
  `);

  // Добавляем категории
  const stmt = db.prepare('INSERT INTO categories (name, type, is_default) VALUES (?, ?, ?)');
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

  categories.forEach(cat => {
    stmt.run(cat);
  });

  stmt.finalize();
  console.log('✅ Категории успешно добавлены!');
});

setTimeout(() => db.close(), 500);