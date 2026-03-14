const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/finance.db');

// Создаем таблицу пользователей
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_DATE
    )
`, (err) => {
    if (err) {
        console.error('Ошибка создания таблицы users:', err);
    } else {
        console.log('Таблица users готова');
    }
});

// Добавляем поле user_id в таблицу transactions
db.run(`
    ALTER TABLE transactions ADD COLUMN user_id INTEGER DEFAULT 1
`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Ошибка добавления user_id:', err);
    } else {
        console.log('Поле user_id добавлено в transactions');
    }
});

// Закрываем соединение
setTimeout(() => {
    db.close();
    console.log('Инициализация БД завершена');
}, 1000);