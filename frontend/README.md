# Frontend

Web-интерфейс проекта Analiz на React + TypeScript + Vite.

## Команды

Установка зависимостей:

```powershell
npm install
```

Запуск dev-сервера:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Сборка:

```powershell
npm run build
```

Проверка eslint:

```powershell
npm run lint
```

## API

Frontend ожидает backend API на `http://127.0.0.1:8001/api`.

Для совместного запуска frontend и backend из корня проекта используйте `start-web.ps1`.
