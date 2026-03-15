const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');
const { Pool } = require('pg');
const { RedisStore } = require('connect-redis');
const redis = require('redis');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let redisClient = null;
let sessionStore = undefined;

if (process.env.REDIS_URL) {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL,
      socket: process.env.REDIS_URL.startsWith('rediss://')
        ? { tls: true }
        : {}
    });

    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });

    redisClient.connect()
      .then(() => {
        console.log('Redis connected');
      })
      .catch((err) => {
        console.error('Redis connection failed:', err);
      });

    sessionStore = new RedisStore({
      client: redisClient
    });
  } catch (err) {
    console.error('Redis init failed:', err);
  }
} else {
  console.log('REDIS_URL not found, using memory session store');
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'finance-app-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  },
  name: 'finance.sid'
}));

let translations = {};

try {
  const localesPath = path.join(__dirname, 'locales');
  const files = fs.readdirSync(localesPath);

  files.forEach((file) => {
    if (!file.endsWith('.json')) return;
    const lang = file.replace('.json', '');
    const filePath = path.join(localesPath, file);
    translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  });

  console.log('Translations loaded');
} catch (e) {
  console.log('Locales folder not found');
}

const defaultCategoryKeyMap = {
  'Зарплата': 'category_salary',
  'Фриланс': 'category_freelance',
  'Подарки': 'category_gifts',
  'Инвестиции': 'category_investments',
  'Другое (доход)': 'category_other_income',
  'Продукты': 'category_products',
  'Транспорт': 'category_transport',
  'Рестораны': 'category_restaurants',
  'Жильё': 'category_housing',
  'Развлечения': 'category_entertainment',
  'Здоровье': 'category_health',
  'Одежда': 'category_clothes',
  'Связь': 'category_communication',
  'Образование': 'category_education',
  'Другое (расход)': 'category_other_expense',

  'Salary': 'category_salary',
  'Freelance': 'category_freelance',
  'Gifts': 'category_gifts',
  'Investments': 'category_investments',
  'Other income': 'category_other_income',
  'Groceries': 'category_products',
  'Transport': 'category_transport',
  'Restaurants': 'category_restaurants',
  'Housing': 'category_housing',
  'Entertainment': 'category_entertainment',
  'Health': 'category_health',
  'Clothes': 'category_clothes',
  'Communication': 'category_communication',
  'Education': 'category_education',
  'Other expense': 'category_other_expense',

  'Жалақы': 'category_salary',
  'Фриланс': 'category_freelance',
  'Сыйлықтар': 'category_gifts',
  'Инвестициялар': 'category_investments',
  'Басқа кіріс': 'category_other_income',
  'Азық-түлік': 'category_products',
  'Көлік': 'category_transport',
  'Мейрамханалар': 'category_restaurants',
  'Тұрғын үй': 'category_housing',
  'Ойын-сауық': 'category_entertainment',
  'Денсаулық': 'category_health',
  'Киім': 'category_clothes',
  'Байланыс': 'category_communication',
  'Білім': 'category_education',
  'Басқа шығыс': 'category_other_expense'
};

app.use((req, res, next) => {
  const allowedLangs = ['ru', 'kk', 'en'];
  const requestedLang = req.query.lang;
  const currentLang = req.session?.lang || 'ru';
  const lang = allowedLangs.includes(requestedLang) ? requestedLang : currentLang;

  if (req.session) {
    req.session.lang = lang;
  }

  const t = (key) =>
    translations[lang]?.[key] ||
    translations.ru?.[key] ||
    key;

  const translateCategory = (categoryName) => {
    const key = defaultCategoryKeyMap[categoryName];
    if (!key) return categoryName;
    return t(key);
  };

  res.locals.lang = lang;
  res.locals.t = t;
  res.locals.translateCategory = translateCategory;

  next();
});

function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect(`/login${req.session?.lang ? `?lang=${req.session.lang}` : ''}`);
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

    const { rows } = await client.query('SELECT COUNT(*) FROM categories');

    if (parseInt(rows[0].count, 10) === 0) {
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

      console.log('Default categories inserted');
    }

    const transCount = await client.query('SELECT COUNT(*) FROM transactions');

    if (parseInt(transCount.rows[0].count, 10) === 0) {
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
        ['expense', 2000, 'Продукты', 'Покупки в магазине', '2025-03-02', 1],
        ['expense', 500, 'Транспорт', 'Метро', '2025-03-03', 1],
        ['income', 3000, 'Фриланс', 'Дизайн проект', '2025-03-04', 1],
        ['expense', 1500, 'Рестораны', 'Обед с друзьями', '2025-03-05', 1]
      ];

      for (const item of testData) {
        await client.query(
          'INSERT INTO transactions (type, amount, category, description, date, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
          item
        );
      }

      console.log('Test data inserted');
    }

    console.log('Database ready');
  } catch (err) {
    console.error('Table init error:', err);
  } finally {
    client.release();
  }
}

pool.connect()
  .then((client) => {
    console.log('Connected to PostgreSQL');
    client.release();
    return createTables();
  })
  .catch((err) => {
    console.error('PostgreSQL connection error:', err);
  });

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      return res.render('login', { error: 'Пользователь не найден' });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.render('login', { error: 'Неверный пароль' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    res.redirect('/');
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

    const userResult = await pool.query(
      'SELECT id, username FROM users WHERE username = $1',
      [username]
    );

    req.session.userId = userResult.rows[0].id;
    req.session.username = userResult.rows[0].username;

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
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC, id DESC LIMIT 5',
      [req.session.userId]
    );

    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS balance
       FROM transactions
       WHERE user_id = $1`,
      [req.session.userId]
    );

    const balance = Number(balanceResult.rows[0]?.balance || 0);

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

  query += ' ORDER BY date DESC, id DESC';

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
      [type, amount, category, description || '', operationDate, req.session.userId]
    );

    res.redirect('/operations');
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при добавлении');
  }
});

app.get('/delete/:id', isAuthenticated, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM transactions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    res.redirect('/operations');
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка удаления');
  }
});

app.get('/categories', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM categories WHERE user_id = $1 OR is_default = 1 ORDER BY is_default DESC, type, name',
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

app.get('/analytics', isAuthenticated, async (req, res) => {
  try {
    const categoryData = await pool.query(
      `SELECT category,
              SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS total_income,
              SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense
       FROM transactions
       WHERE user_id = $1
       GROUP BY category
       ORDER BY category`,
      [req.session.userId]
    );

    const monthlyData = await pool.query(
      `SELECT TO_CHAR(date, 'YYYY-MM') AS month,
              SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
              SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
       FROM transactions
       WHERE user_id = $1
       GROUP BY TO_CHAR(date, 'YYYY-MM')
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

app.get('/api/categories', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM categories WHERE user_id = $1 OR is_default = 1 ORDER BY type, name',
      [req.session.userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.post('/api/categories', isAuthenticated, async (req, res) => {
  const { name, type } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }

  try {
    const exists = await pool.query(
      'SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND type = $2 AND (user_id = $3 OR is_default = 1)',
      [name.trim(), type, req.session.userId]
    );

    if (exists.rows.length > 0) {
      return res.status(400).json({ error: 'Категория уже существует' });
    }

    const result = await pool.query(
      'INSERT INTO categories (name, type, user_id) VALUES ($1, $2, $3) RETURNING id, name, type, user_id, is_default',
      [name.trim(), type, req.session.userId]
    );

    res.json(result.rows[0]);
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

app.get('/api/transaction/:id', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Не найдено' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/transaction/:id', isAuthenticated, async (req, res) => {
  const { type, amount, category, description, date } = req.body;

  try {
    const result = await pool.query(
      `UPDATE transactions
       SET type = $1, amount = $2, category = $3, description = $4, date = $5
       WHERE id = $6 AND user_id = $7`,
      [type, amount, category, description || '', date, req.params.id, req.session.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Транзакция не найдена' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

app.get('/api/chart-data', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT category,
              SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS total_income,
              SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense
       FROM transactions
       WHERE user_id = $1
       GROUP BY category
       ORDER BY category`,
      [req.session.userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).send('ok');
  } catch (err) {
    res.status(500).send('db error');
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
