# Базовий образ
FROM node:20-alpine

# Робоча директорія
WORKDIR /usr/src/app

# Спочатку копіюємо package-файли (для кешування установки залежностей)
COPY package*.json ./

# Встановлюємо всі залежності (prod + dev, щоб був nodemon)
RUN npm install

# Копіюємо увесь вихідний код
COPY . .

# Створюємо директорію для кешу (якщо немає)
RUN mkdir -p cache

# Вказуємо порт всередині контейнера (має відповідати PORT з .env)
EXPOSE 3000

# Команда за замовчуванням (може бути перезаписана в docker-compose)
CMD ["npm", "run", "start"]
