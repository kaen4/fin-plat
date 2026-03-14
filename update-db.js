const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/finance.db');

// Создаем таблицу категорий
db.run(`
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        user_id INTEGER,
        is_default INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`, function(err) {
    if (err) {
        console.error('Ошибка создания таблицы categories:', err);
    } else {
        console.log('Таблица categories создана');
        
        // Добавляем категории по умолчанию
        const defaultCategories = [
            // Доходы
            ['Зарплата', 'income', null, 1],
            ['Фриланс', 'income', null, 1],
            ['Подарки', 'income', null, 1],
            ['Инвестиции', 'income', null, 1],
            ['Другое', 'income', null, 1],
            // Расходы
            ['Продукты', 'expense', null, 1],
            ['Транспорт', 'expense', null, 1],
            ['Рестораны', 'expense', null, 1],
            ['Жильё', 'expense', null, 1],
            ['Развлечения', 'expense', null, 1],
            ['Здоровье', 'expense', null, 1],
            ['Одежда', 'expense', null, 1],
            ['Связь', 'expense', null, 1],
            ['Образование', 'expense', null, 1],
            ['Другое', 'expense', null, 1]
        ];
        
        const stmt = db.prepare("INSERT OR IGNORE INTO categories (name, type, user_id, is_default) VALUES (?, ?, ?, ?)");
        
        defaultCategories.forEach(cat => {
            stmt.run(cat, function(err) {
                if (err) console.error('Ошибка вставки категории:', err);
            });
        });
        
        stmt.finalize();
        console.log('Категории по умолчанию добавлены');
    }
});

setTimeout(() => {
    db.close();
    console.log('Обновление БД завершено');
}, 2000);