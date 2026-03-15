const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');
const { Pool } = require('pg'); 

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const { RedisStore } = require('connect-redis');
const redis = require('redis');

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

app.set("trust proxy", 1);

let redisClient;
let sessionStore;

if (process.env.REDIS_URL) {
    try {
        redisClient = redis.createClient({
            url: process.env.REDIS_URL,
            socket: process.env.REDIS_URL.startsWith('rediss://')
                ? { tls: true }
                : {}
        });
        redisClient.connect().then(() => {
            console.log('✅ Redis подключён для хранения сессий');
        }).catch(err => {
            console.error('❌ Redis connection error:', err);
        });
        sessionStore = new RedisStore({ client: redisClient });
    } catch (err) {
        console.error('❌ Ошибка инициализации Redis:', err);
    }
} else {
    console.log('⚠️ REDIS_URL не найден, сессии будут храниться в памяти (не для production)');
}

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
    },
    name: 'finance.sid'
}));

app.use((req, res, next) => {
    const lang = req.query.lang || req.session?.lang || 'ru';
    req.session.lang = lang;
    res.locals.lang = lang;
    res.locals.t = (key) => translations[lang]?.[key] || translations['ru']?.[key] || key;
    next();
});

function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

async function createTables() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at DATE DEFAULT CURRENT_DATE
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                is_default INTEGER DEFAULT 0
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                description TEXT,
                date DATE DEFAULT CURRENT_DATE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        console.log('Таблицы созданы или уже существуют');

        const { rows } = await client.query('SELECT COUNT(*) FROM categories');
        if (parseInt(rows[0].count) === 0) {
            const defaultCategories = [
                ['Зарплата', 'income', null, 1],
                ['Фриланс', 'income', null, 1],
                ['Подарки', 'income', null, 1],
                ['Инвестиции', 'income', null, 1],
                ['Другое (доход)', 'income', null, 1],
                ['Продукты', 'expense', null, 1],
                ['Транспорт', 'expense', null, 1],
                ['Рестораны', 'expense', null, 1],
                ['Жильё', 'expense', null, 1],
                ['Развлечения', 'expense', null, 1],
                ['Здоровье', 'expense', null, 1],
                ['Одежда', 'expense', null, 1],
                ['Связь', 'expense', null, 1],
                ['Образование', 'expense', null, 1],
                ['Другое (расход)', 'expense', null, 1]
            ];
            for (const cat of defaultCategories) {
                await client.query(
                    'INSERT INTO categories (name, type, user_id, is_default) VALUES ($1, $2, $3, $4)',
                    cat
                );
            }
            console.log('Категории по умолчанию добавлены');
        }

        const transCount = await client.query('SELECT COUNT(*) FROM transactions');
        if (parseInt(transCount.rows[0].count) === 0) {
            const userCheck = await client.query('SELECT id FROM users WHERE id = 1');
            if (userCheck.rows.length === 0) {
                const hash = await bcrypt.hash('test123', 10);
                await client.query(
                    'INSERT INTO users (id, username, password) VALUES (1, $1, $2)',
                    ['test', hash]
                );
            }
            const testData = [
                ['income', 50000, 'Зарплата', 'Зарплата за март', '2025-03-01', 1],
                ['expense', 2000, 'Продукты', 'Магнит', '2025-03-02', 1],
                ['expense', 500, 'Транспорт', 'Метро', '2025-03-03', 1],
                ['income', 3000, 'Фриланс', 'Дизайн проект', '2025-03-04', 1],
                ['expense', 1500, 'Рестораны', 'Обед с друзьями', '2025-03-05', 1]
            ];
            for (const t of testData) {
                await client.query(
                    'INSERT INTO transactions (type, amount, category, description, date, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
                    t
                );
            }
            console.log('Тестовые данные добавлены');
        }

    } catch (err) {
        console.error('Ошибка при создании таблиц:', err);
    } finally {
        client.release();
    }
}

pool.connect((err) => {
    if (err) {
        console.error('Ошибка подключения к PostgreSQL:', err);
    } else {
        console.log('Подключено к PostgreSQL');
        createTables();
    }
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user) {
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
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Ошибка сервера' });
    }
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
        await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2)',
            [username, hashedPassword]
        );
        const user = await pool.query('SELECT id, username FROM users WHERE username = $1', [username]);
        req.session.userId = user.rows[0].id;
        req.session.username = user.rows[0].username;
        res.redirect('/');
    } catch (err) {
        if (err.code === '23505') {
            return res.render('register', { error: 'Имя пользователя уже занято' });
        }
        console.error(err);
        res.render('register', { error: 'Ошибка регистрации' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

app.get('/', isAuthenticated, async (req, res) => {
    try {
        const recent = await pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC LIMIT 5',
            [req.session.userId]
        );
        const balanceResult = await pool.query(
            `SELECT SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) as balance 
             FROM transactions WHERE user_id = $1`,
            [req.session.userId]
        );
        const balance = balanceResult.rows[0]?.balance || 0;
        res.render('index', {
            recentTransactions: recent.rows,
            balance,
            user: req.session.username,
            currentPage: 'dashboard'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки данных');
    }
});

app.get('/operations', isAuthenticated, async (req, res) => {
    let query = 'SELECT * FROM transactions WHERE user_id = $1';
    const params = [req.session.userId];
    let paramIndex = 2;
    if (req.query.date_from) {
        query += ` AND date >= $${paramIndex++}`;
        params.push(req.query.date_from);
    }
    if (req.query.date_to) {
        query += ` AND date <= $${paramIndex++}`;
        params.push(req.query.date_to);
    }
    if (req.query.type && req.query.type !== 'all') {
        query += ` AND type = $${paramIndex++}`;
        params.push(req.query.type);
    }
    if (req.query.category) {
        query += ` AND category ILIKE $${paramIndex++}`;
        params.push(`%${req.query.category}%`);
    }
    query += ' ORDER BY date DESC';

    try {
        const transactions = await pool.query(query, params);
        const categories = await pool.query(
            'SELECT * FROM categories WHERE user_id = $1 OR is_default = 1 ORDER BY type, name',
            [req.session.userId]
        );
        res.render('operations', {
            transactions: transactions.rows,
            categories: categories.rows,
            filters: req.query,
            user: req.session.username,
            currentPage: 'operations'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки данных');
    }
});

app.post('/add', isAuthenticated, async (req, res) => {
    const { type, amount, category, description, date } = req.body;
    const operationDate = date || new Date().toISOString().split('T')[0];
    try {
        await pool.query(
            'INSERT INTO transactions (type, amount, category, description, date, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [type, amount, category, description, operationDate, req.session.userId]
        );
        res.redirect('/operations');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при добавлении');
    }
});

app.get('/delete/:id', isAuthenticated, async (req, res) => {
    try {
        await pool.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
        res.redirect('/operations');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка удаления');
    }
});

app.get('/categories', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM categories WHERE user_id = $1 OR is_default = 1 ORDER BY type, name',
            [req.session.userId]
        );
        res.render('categories', {
            categories: result.rows,
            user: req.session.username,
            currentPage: 'categories'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки категорий');
    }
});

app.post('/api/categories', isAuthenticated, async (req, res) => {
    const { name, type } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Заполните все поля' });
    try {
        const result = await pool.query(
            'INSERT INTO categories (name, type, user_id) VALUES ($1, $2, $3) RETURNING id',
            [name, type, req.session.userId]
        );
        res.json({ id: result.rows[0].id, name, type });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка добавления' });
    }
});

app.delete('/api/categories/:id', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM categories WHERE id = $1 AND user_id = $2 AND is_default = 0',
            [req.params.id, req.session.userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Категория не найдена или не может быть удалена' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.get('/analytics', isAuthenticated, async (req, res) => {
    try {
        const categoryData = await pool.query(
            `SELECT category,
                    SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
                    SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense
             FROM transactions
             WHERE user_id = $1
             GROUP BY category`,
            [req.session.userId]
        );
        const monthlyData = await pool.query(
            `SELECT TO_CHAR(date, 'YYYY-MM') as month,
                    SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
             FROM transactions
             WHERE user_id = $1
             GROUP BY month
             ORDER BY month`,
            [req.session.userId]
        );
        res.render('analytics', {
            categoryData: categoryData.rows,
            monthlyData: monthlyData.rows,
            user: req.session.username,
            currentPage: 'analytics'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка загрузки аналитики');
    }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('Сервер запущен');
});