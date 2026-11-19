# GEMINI.md — Конституция проекта PoseMatch

## 1. Назначение проекта
**PoseMatch** — веб-приложение для съемки фото с точным повторением позы по эталону (AI-ассистент позирования на базе MediaPipe Pose Landmarker).

## 2. Технологический стек
- **Runtime:** Чистый браузерный JavaScript (ES2022+ нативные ES-модули, без Webpack/Vite/Babel).
- **Внешние зависимости в браузере:** `@mediapipe/tasks-vision@0.10.14` через `<script type="importmap">` и CDN `jsdelivr`.
- **Графика и медиа:** HTML5 `<canvas>`, `navigator.mediaDevices.getUserMedia`, Web Audio API, Web Speech API (`speechSynthesis`).
- **Хранение:** `localStorage` для пользовательских калибровок и настроек (сессионные снимки в памяти).
- **UI:** Mobile-First поток (`max-width: 480px`, центрирование на ПК), нативный CSS без фреймворков.
- **Качество кода (devDependencies):** Prettier, ESLint, TypeScript (`tsc --noEmit --allowJs --checkJs`), Vitest, Knip, `npm audit`.

## 3. Архитектурные запреты и правила
1. **Никаких сборщиков (No-Bundler):** весь код в `src/` должен запускаться напрямую через `<script type="module" src="./src/main.js">` и локальный HTTP-сервер.
2. **Лимит размера файла:** строго **не более 350 строк** на любой файл кода (`src/**`, `styles/**`, `tests/**`, `index.html`). Если файл приближается к 300 строкам — декомпозировать на узкие модули.
3. **Разделение слоев:**
   - `src/core/*` — только чистые функции и константы. Никаких обращений к `document`, `window`, `navigator` или `localStorage`.
   - `src/services/*` — обертки над браузерными API и MediaPipe; не управляют DOM экранов напрямую.
   - `src/state/*` — единый Store состояния (`AppState`).
   - `src/ui/*` — рендеринг, роутинг и обработчики событий.
4. **Строгая JSDoc-типизация:** все функции, параметры, возвращаемые значения и объекты состояния типизируются через JSDoc (`@typedef`, `@param`, `@returns`) и проверяются `tsc --noEmit`. Использование `@ts-ignore` запрещено.
5. **Принцип YAGNI:** не добавлять абстракции, библиотеки, роутеры или фичи, которых нет в `SPEC.md` и текущем этапе `STATE.md`.
6. **Конвейер качества:** задача считается выполненной только после `npm run verify` с кодом выхода `0` и обновления `STATE.md` / `ARCHITECTURE.md`.
