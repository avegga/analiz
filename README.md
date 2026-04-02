# Analiz Web

Проект переведен в web-only режим.

Структура:

- `backend/` — FastAPI API для загрузки xlsx, анализа и экспорта.
- `frontend/` — React + Vite интерфейс.
- `start-web.ps1` — единый запуск backend и frontend.

## Быстрый старт

1. Создайте и активируйте виртуальное окружение Python в корне проекта.
2. Установите Python-зависимости:

```powershell
pip install -r requirements.txt
```

3. Установите frontend-зависимости:

```powershell
cd frontend
npm install
cd ..
```

4. Запустите web-приложение:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-web.ps1
```

После запуска сервисы доступны по адресам:

- Frontend: `http://127.0.0.1:5173/`
- Backend API: `http://127.0.0.1:8001/`

## Ручной запуск

Backend:

```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn src.main:app --host 127.0.0.1 --port 8001
```

Frontend:

```powershell
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```