const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Настройка middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Настройка сессий
app.use(session({
    secret: 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Настройка шаблонизатора
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Подключение к БД
const db = new sqlite3.Database('./database/finance.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err);
    } else {
        console.log('Подключено к базе данных SQLite');
        createTables();
    }
});

// Загрузка переводов
let translations = {};
try {
    fs.readdirSync('./locales').forEach(file => {
        const lang = file.replace('.json', '');
        translations[lang] = JSON.parse(fs.readFileSync(`./locales/${file}`));
    });
    console.log('Переводы загружены');
} catch (e) {
    console.log('Папка locales не найдена, создайте её');
}

// Middleware для языка
app.use((req, res, next) => {
    const lang = req.query.lang || req.session.lang || 'ru';
    req.session.lang = lang;
    res.locals.lang = lang;
    res.locals.t = (key) => translations[lang]?.[key] || translations['ru']?.[key] || key;
    next();
});

// Проверка авторизации
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Создание таблиц
function createTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            date TEXT DEFAULT CURRENT_DATE
        )
    `, (err) => {
        if (err) console.error('Ошибка создания transactions:', err);
        else console.log('Таблица transactions готова');
    });
    
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_DATE
        )
    `, (err) => {
        if (err) console.error('Ошибка создания users:', err);
        else {
            console.log('Таблица users готова');
            
            db.all("PRAGMA table_info(transactions)", (err, rows) => {
                if (err) return;
                
                const hasUserId = rows.some(col => col.name === 'user_id');
                if (!hasUserId) {
                    db.run("ALTER TABLE transactions ADD COLUMN user_id INTEGER DEFAULT 1", (err) => {
                        if (err) console.log('user_id уже есть');
                        else console.log('user_id добавлена');
                        
                        checkAndInsertTestData();
                    });
                } else {
                    checkAndInsertTestData();
                }
            });
        }
    });
}

// Тестовые данные
function checkAndInsertTestData() {
    db.get("SELECT COUNT(*) as count FROM transactions", (err, row) => {
        if (err || row.count > 0) return;
        
        const testData = [
            ['income', 50000, 'Зарплата', 'Зарплата за март', '2025-03-01', 1],
            ['expense', 2000, 'Продукты', 'Магнит', '2025-03-02', 1],
            ['expense', 500, 'Транспорт', 'Метро', '2025-03-03', 1],
            ['income', 3000, 'Фриланс', 'Дизайн проект', '2025-03-04', 1],
            ['expense', 1500, 'Рестораны', 'Обед с друзьями', '2025-03-05', 1]
        ];

        const stmt = db.prepare("INSERT INTO transactions (type, amount, category, description, date, user_id) VALUES (?, ?, ?, ?, ?, ?)");
        testData.forEach(data => stmt.run(data));
        stmt.finalize();
        console.log('Тестовые данные добавлены');
    });
}

// ========== АВТОРИЗАЦИЯ ==========

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err || !user) {
            return res.render('login', { error: 'Пользователь не найден' });
        }
        
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.userId = user.id;
            req.session.username = user.username;
            res.redirect('/');
        } else {
            res.render('login', { error: 'Неверный пароль' });
        }
    });
});

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.render('register', { error: 'Заполните все поля' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run("INSERT INTO users (username, password) VALUES (?, ?)",
            [username, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.render('register', { error: 'Имя пользователя уже занято' });
                    }
                    return res.render('register', { error: 'Ошибка регистрации' });
                }
                
                req.session.userId = this.lastID;
                req.session.username = username;
                res.redirect('/');
            }
        );
    } catch (err) {
        res.render('register', { error: 'Ошибка сервера' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ========== ОСНОВНЫЕ МАРШРУТЫ ==========

app.get('/', isAuthenticated, (req, res) => {
    let query = "SELECT * FROM transactions WHERE user_id = ?";
    let params = [req.session.userId];
    
    if (req.query.date_from) {
        query += " AND date >= ?";
        params.push(req.query.date_from);
    }
    
    if (req.query.date_to) {
        query += " AND date <= ?";
        params.push(req.query.date_to);
    }
    
    if (req.query.type && req.query.type !== 'all') {
        query += " AND type = ?";
        params.push(req.query.type);
    }
    
    if (req.query.category) {
        query += " AND category LIKE ?";
        params.push(`%${req.query.category}%`);
    }
    
    query += " ORDER BY date DESC";
    
    db.all(query, params, (err, rows) => {
        if (err) {
            return res.send('Ошибка загрузки данных');
        }
        
        let balance = 0;
        rows.forEach(t => {
            balance += t.type === 'income' ? t.amount : -t.amount;
        });
        
        res.render('index', { 
            transactions: rows, 
            balance: balance,
            filters: req.query || {},
            user: req.session.username
        });
    });
});

app.post('/add', isAuthenticated, (req, res) => {
    const { type, amount, category, description, date } = req.body;
    
    // Если дата не указана, используем текущую
    const operationDate = date || new Date().toISOString().split('T')[0];
    
    db.run(
        "INSERT INTO transactions (type, amount, category, description, date, user_id) VALUES (?, ?, ?, ?, ?, ?)",
        [type, amount, category, description, operationDate, req.session.userId],
        function(err) {
            if (err) {
                console.error('Ошибка добавления:', err);
                res.status(500).send('Ошибка при добавлении');
            } else {
                res.redirect('/');
            }
        }
    );
});

app.get('/delete/:id', isAuthenticated, (req, res) => {
    db.run("DELETE FROM transactions WHERE id = ? AND user_id = ?", 
        [req.params.id, req.session.userId], 
        (err) => {
            if (err) console.error(err);
            res.redirect('/');
        }
    );
});

app.get('/api/chart-data', isAuthenticated, (req, res) => {
    db.all(`
        SELECT 
            category,
            SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
            SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense
        FROM transactions
        WHERE user_id = ?
        GROUP BY category
    `, [req.session.userId], (err, rows) => {
        res.json(rows || []);
    });
});
// API для получения категорий пользователя
app.get('/api/categories', isAuthenticated, (req, res) => {
    const query = `
        SELECT * FROM categories 
        WHERE user_id = ? OR (user_id IS NULL AND is_default = 1)
        ORDER BY type, name
    `;
    
    db.all(query, [req.session.userId], (err, rows) => {
        if (err) {
            console.error('Ошибка получения категорий:', err);
            res.json([]);
        } else {
            res.json(rows);
        }
    });
});

// Добавление новой категории
app.post('/api/categories', isAuthenticated, (req, res) => {
    const { name, type } = req.body;
    
    if (!name || !type) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    db.run(
        "INSERT INTO categories (name, type, user_id) VALUES (?, ?, ?)",
        [name, type, req.session.userId],
        function(err) {
            if (err) {
                console.error('Ошибка добавления категории:', err);
                res.status(500).json({ error: 'Ошибка добавления' });
            } else {
                res.json({ id: this.lastID, name, type });
            }
        }
    );
});
// Получить одну транзакцию для редактирования
app.get('/api/transaction/:id', isAuthenticated, (req, res) => {
    db.get(
        "SELECT * FROM transactions WHERE id = ? AND user_id = ?",
        [req.params.id, req.session.userId],
        (err, row) => {
            if (err) {
                console.error('Ошибка получения транзакции:', err);
                res.status(500).json({ error: 'Ошибка сервера' });
            } else if (!row) {
                res.status(404).json({ error: 'Транзакция не найдена' });
            } else {
                res.json(row);
            }
        }
    );
});

// Обновить транзакцию
app.put('/api/transaction/:id', isAuthenticated, (req, res) => {
    const { type, amount, category, description, date } = req.body;
    
    db.run(
        `UPDATE transactions 
         SET type = ?, amount = ?, category = ?, description = ?, date = ?
         WHERE id = ? AND user_id = ?`,
        [type, amount, category, description, date, req.params.id, req.session.userId],
        function(err) {
            if (err) {
                console.error('Ошибка обновления:', err);
                res.status(500).json({ error: 'Ошибка обновления' });
            } else if (this.changes === 0) {
                res.status(404).json({ error: 'Транзакция не найдена' });
            } else {
                res.json({ success: true });
            }
        }
    );
});
// Запуск сервера - ЭТА ВЕРСИЯ ДЛЯ RENDER
const PORT = process.env.PORT || 3000; // Render сам подставит порт
app.listen(PORT, '0.0.0.0', () => {    // Слушаем все интерфейсы
    console.log(`Сервер запущен на порту ${PORT}`);
});
});