# STATE.md — Текущее состояние проекта PoseMatch

## Текущий этап
**Этап 4: Полевое QA на смартфоне и релиз `v1.0.0`** — Этап 3 (`Adversarial Review` и рефакторинг) ЗАВЕРШЕН. Все блокеры P0, дефекты P1 и гигиена P2 закрыты, `npm run verify` проходит чисто с кодом `0`. Следующая задача: **деплой на GitHub Pages и полевое QA на реальных смартфонах (Android Chrome / iOS Safari) перед релизом `v1.0.0`**.

## Выполненные этапы
- [x] **Этап 0: Валидация ядра (0 -> 1)** — создан однофайловый прототип `index.html` с MediaPipe GPU/CPU fallback, математикой углов скелета, режимом «К телу», отзеркаливанием, Web Audio «Парктроник», голосовыми подсказками, ручной калибровкой и захватом кадра.
- [x] **Этап 1: Инициализация архитектуры и конвейера качества (1 -> N)** — модульная архитектура `src/*` (<= 350 строк на файл), контракты `SPEC.md` / `src/core/types.js`, настроенный и зеленый конвейер `npm run verify`.

## Задачи Этапа 1
- [x] Создать файлы внешней памяти (`GEMINI.md`, `SPEC.md`, `ARCHITECTURE.md`, `STATE.md`, `.geminiignore`).
- [x] Разбить монолит на чистые ES-модули (`src/core/*`, `src/services/*`, `src/state/*`, `src/ui/*`, `styles/*`) строго <= 350 строк на файл.
- [x] Подключить `<script type="importmap">` для `@mediapipe/tasks-vision` в `index.html` и рабочий 4-экранный каркас.
- [x] Настроить `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `knip.json`, `vitest.config.js` и скрипт `npm run verify`.
- [x] Написать юнит-тесты `tests/poseMath.test.js` и довести `npm run verify` до кода 0.

## Бэклог Этапа 2 (Feature Loop — после завершения Этапа 1)
- [x] **Фича 2.1:** Детальная UI/UX-полировка **Экрана 1 (Главный хаб — Golden Example)**: dropzone (файл, Drag & Drop без мигания, Ctrl+V), состояние анализа позы, фильтры, активная карточка, переименование/удаление в «Моих» с синхронизацией в `localStorage` и обработкой `QuotaExceededError`, Empty State, счетчик галереи.
- [x] **Фича 2.2:** Полная функциональная реализация **Экрана 2 (Калибровка позы, Functional-First)**: перетаскивание суставов (Pointer Events с `setPointerCapture`), единый детектор двойного тапа на `pointerup` + ПКМ для вкл/выкл с бейджем «Выкл.», блок чипсов «Скрытые точки» и «Вернуть все», синхронное отзеркаливание фото и скелета (L/R swap + запекание при сохранении), сброс, валидация имени/скелета и обработка `QuotaExceededError`, решение 2A (сохранение -> `camera`, отмена -> предыдущий экран) и фиксация Camera-First v2 в `SPEC.md`.
- [x] **Фича 2.3:** Функциональная реализация **Экрана 3 (Съемка по позе)** и переход на Camera-First v2 (старт с Камеры, пауза камеры 1A при переходе в «Библиотеку поз»): плавающая миниатюра «Эталон», крупный % совпадения, сетка 2x2 переключателей, кнопка-кольцо «АВТО» с SVG-прогрессом 800 ms, `Camera Fallback State`, оверлей обратного отсчета 3-2-1 с отменой и чистый модуль `cameraHudLogic.js`.
- [x] **Фича 2.4:** Полная функциональная реализация **Экрана 4 (Галерея Side-by-Side, Functional-First)**: сравнение «Эталон» vs «Ваше фото» с сохранением пропорций, безопасный вывод метаданных (название позы, `%`, дубль/время), переключатель скелета поверх фото (через `drawStaticSkeleton` с защитой от отсутствующих `landmarks`), прокручиваемая лента дублей сессии с inline-удалением и `Empty State`, скачивание чистого JPG с санитизированным именем файла, чистый модуль `galleryLogic.js` и тесты `galleryFeature.test.js`.
- [x] **Фича 2.5:** Добавление PWA (`manifest.webmanifest`, валидные PNG/SVG иконки для Android/iOS/desktop, Service Worker `sw.js` с `Network-First` для оболочки и `Cache-First` для CDN MediaPipe, чистый модуль `pwaLogic.js`, неблокирующая регистрация `pwaService.js` и тесты `pwaFeature.test.js`).
- [x] **Этап 3:** Кросс-ревью и рефакторинг (Adversarial Review) — закрыты P0 (`visibilitychange`/`pagehide`/`track.onended`, гонка `res.aborted`, запрет кэширования редиректов/opaque в SW), P1 (валидация `localStorage`, fallback `createDefaultSkeleton` в `hubUpload`, сквозной `mirrorCamera` для тыловой камеры и записи 3с, `revokeObjectURL` на `pagehide`/60s, `seq`-защита `img.onload`, Autoplay Policy для `AudioContext` + защита `speechSynthesis`, тач-фиксы калибровки, починка вложенных `describe` в `cameraFeature.test.js` + новые тесты) и P2 (`knip.json`, чистка мертвого CSS, `roundRect` fallback, `status-bar-style="black"`, `try/catch` в `dataUrlToBlob`).
- [x] **Мобильный хотфикс (BUG-M2, BUG-M3, BUG-M1b):** освобождение сенсора Android-камеры (пауза 150 мс, снятие `ended`, `facingMode`-fallback) и скрытие `.hud-bar` при ошибке; прайминг `speechSynthesis`, очередь `cancel()`+60 мс+`resume()`+`speak()`, явный `ru`-голос и inline-уведомление об отсутствии русского TTS; каскад `Lite 0.2` -> `Heavy 0.2` -> `Heavy` на padded-холсте 15% с фильтром и обратным маппингом координат.
- [ ] **Этап 4:** Полевое QA на смартфоне и релиз `v1.0.0`.

## Продуктовые решения по дорожной карте
- Спринт визуального редизайна перенесен в бэклог **`v1.1`**. Текущая дорожная карта до релиза `v1.0.0`: **Этап 2 (завершен, Фичи 2.1–2.5)** -> **Этап 3 (завершен, Adversarial Review)** -> **Этап 4 (Деплой на GitHub Pages, полевое QA на смартфоне и релиз v1.0.0)**.
