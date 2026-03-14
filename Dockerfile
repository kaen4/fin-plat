FROM node:18-alpine

WORKDIR /app

# Копируем файлы с зависимостями
COPY package*.json ./

# Устанавливаем зависимости (без --build-from-source, используем готовый бинарник)
RUN npm install

# Копируем остальной код
COPY . .

# Указываем порт
EXPOSE 3000

# Команда запуска
CMD ["node", "app.js"]