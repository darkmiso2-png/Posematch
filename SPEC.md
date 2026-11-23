# SPEC.md — Функциональные требования и контракты данных PoseMatch

## 1. Пользовательский поток (4-экранный Mobile-First UI)
Интерфейс строится в мобильной колонке `max-width: 480px`, центрированной на десктопе:
- **Экран 1: Главный хаб / Библиотека поз (`hub`)** — загрузка фото-референса (файл, drag-and-drop, вставка из буфера), запуск 3-секундной записи позы с камеры, фильтры шаблонов (`all`, `portrait`, `fullbody`, `dynamic`, `saved`), список пользовательских калибровок, переход в галерею. (Продуктовое решение **Camera-First v2**: начиная с Фичи 2.3 старт приложения переносится на Экран Камеры, переход в «Библиотеку поз» выполняется полноэкранно с паузой камеры `1A`, а «Запись позы 3с» запускается с Камеры.)
- **Экран 2: Калибровка позы (`calibration`)** — ручная доводка 13 редактируемых суставов эталона на `<canvas>`, перетаскивание точек (Pointer Events), единый двойной тап/клик по суставу (или ПКМ) для выключения/включения точки с бейджем «Выкл.» и блоком чипсов «Скрытые точки» («Вернуть все»), синхронное отзеркаливание фото и скелета (со свопом L/R индексов MediaPipe), сброс к исходным точкам, ввод и валидация имени позы, защита от сохранения пустого скелета (`< 2` активных сегментов). Решение **2A**: кнопка «Сохранить» всегда сохраняет эталон в `localStorage` (с обработкой `QuotaExceededError`), делает его `activeReference` и сразу переводит на экран `camera`; кнопка «Назад» сбрасывает `draftCalibration` без сохранения и возвращает на предыдущий экран (`hub` или `camera`).
- **Экран 3: Съемка по позе (`camera`)** — полноэкранный видоискатель, миниатюра эталона (синхронная с живым оверлеем), крупный % совпадения (0–100%), текстовая подсказка, 2x2 переключатели («К телу», «Зеркало позы», «Парктроник», «Голос»), выбор камеры и переключатель «Честная передняя камера» («как в зеркале» vs «честный кадр», автоматически `disabled` на задней камере), слайдер порога (60–95%), кнопка-кольцо «АВТО» с прогрессом удержания (`AUTO_SHUTTER_HOLD_MS = 800` ms) и ручным спуском, кнопка 3-секундной записи позы.
- **Экран 4: Галерея и сравнение Side-by-Side (`gallery`)** — сравнение «Эталон» vs «Ваше фото», метаданные выбранного снимка (название позы, `%` совпадения, номер дубля и время), переключатель отображения скелета поверх фото, лента дублей текущей сессии с inline-удалением и `Empty State` («← К камере»), скачивание чистого JPG-кадра с санитизированным именем файла.

## 2. Жесткие контракты данных (Data Schema First)

### `JointPoint`
```js
/**
 * @typedef {Object} JointPoint
 * @property {number} x - Нормализованная координата X [0..1]
 * @property {number} y - Нормализованная координата Y [0..1]
 * @property {number} [z] - Глубина относительно бедер (опционально из MediaPipe)
 * @property {number} [visibility] - Активность/видимость точки [0..1]; < 0.35 считается выключенной
 */
```
Порог активности: `JOINT_VISIBILITY_THRESHOLD = 0.35`. При выключении точки в калибровке ставится `visibility: 0`, при включении — `visibility: 1`.

### `PoseReference`
```js
/**
 * @typedef {"preset" | "upload" | "recorded" | "custom"} ReferenceSource
 * @typedef {"all" | "portrait" | "fullbody" | "dynamic" | "saved"} PresetCategory
 *
 * @typedef {Object} PoseReference
 * @property {string} id - Уникальный идентификатор (UUID или slug пресета)
 * @property {string} name - Отображаемое название позы
 * @property {ReferenceSource} source - Источник создания эталона
 * @property {PresetCategory} category - Категория для фильтра на Главном хабе
 * @property {string} imageDataUrl - Data URL изображения эталона (или сгенерированного пресета)
 * @property {number} aspect - Соотношение сторон width / height исходного кадра
 * @property {JointPoint[]} landmarks - Массив из 33 точек скелета (текущая калибровка)
 * @property {JointPoint[]} autoLandmarks - Исходные точки от MediaPipe (для кнопки «Сброс»)
 * @property {boolean} autoDetected - true, если поза найдена нейросетью; false при fallback-скелете
 * @property {number} createdAt - Unix timestamp (ms)
 */
```

### `CapturedShot`
```js
/**
 * @typedef {Object} CapturedShot
 * @property {string} id - Уникальный идентификатор снимка
 * @property {string} referenceId - ID эталона PoseReference, по которому сделан кадр
 * @property {string} [referenceName] - Название эталона на момент съемки (опционально)
 * @property {string} [referenceImageDataUrl] - Data URL эталона на момент съемки (опционально)
 * @property {boolean} [refMirrored] - Состояние mirrorRef на момент съемки (опционально)
 * @property {boolean} [cameraMirrored] - Было ли применено зеркалирование камеры при захвате кадра (опционально)
 * @property {Blob | null} [imageBlob] - Чистый JPEG Blob кадра в памяти (основное хранилище сессии)
 * @property {string} [imageUrl] - Временный Object URL (`blob:...`), созданный из imageBlob (отзывается через URL.revokeObjectURL)
 * @property {string} [imageDataUrl] - Опциональный fallback Data URL (обратная совместимость для сред без toBlob и моков)
 * @property {number} score - Итоговый процент совпадения (0..100)
 * @property {JointPoint[] | null} userLandmarks - Скелет пользователя в момент спуска
 * @property {JointPoint[] | null} refLandmarks - Эффективный скелет эталона (с учетом mirrorRef)
 * @property {number} createdAt - Unix timestamp (ms)
 */
```

### `AppState`
```js
/**
 * @typedef {"hub" | "calibration" | "camera" | "gallery"} ScreenId
 *
 * @typedef {Object} AppSettings
 * @property {boolean} attachToBody - Режим «К телу» (привязка масштаба и позиции к торсу)
 * @property {boolean} mirrorRef - Отзеркаливание эталонного скелета
 * @property {boolean} mirrorFrontCamera - Зеркалирование передней камеры (true — «как в зеркале», false — «честный кадр»)
 * @property {boolean} parktronic - Звуковой «Парктроник» (Web Audio API)
 * @property {boolean} voice - Голосовые подсказки (Web Speech API)
 * @property {number} threshold - Порог автоспуска в процентах (60..95)
 * @property {string} activeDeviceId - ID выбранной камеры
 *
 * @typedef {Object} RuntimeStatus
 * @property {"loading" | "gpu" | "cpu" | "error"} mpStatus - Состояние движка MediaPipe
 * @property {string} mpMessage - Текст статуса нейросети для UI
 * @property {boolean} cameraReady - Активен ли видеопоток
 * @property {string | null} cameraError - Сообщение об ошибке доступа к камере
 * @property {boolean} isRecordingPose - Идет ли 3-секундный отсчет записи позы
 * @property {number} countdownSec - Остаток секунд (3..1 или 0)
 * @property {number} holdMs - Время удержания позы >= threshold (ms, цель AUTO_SHUTTER_HOLD_MS = 800)
 * @property {number} shutterCooldownMs - Кулдаун после автоспуска (ms)
 *
 * @typedef {Object} AppState
 * @property {ScreenId} currentScreen - Активный экран из 4-экранного потока
 * @property {PresetCategory} activeFilter - Выбранный фильтр шаблонов на Экране 1
 * @property {PoseReference[]} presets - Встроенные пресеты
 * @property {PoseReference[]} savedCalibrations - Пользовательские калибровки (localStorage)
 * @property {PoseReference | null} activeReference - Текущий выбранный эталон для съемки
 * @property {PoseReference | null} draftCalibration - Черновик позы на Экране 2 (до подтверждения)
 * @property {CapturedShot[]} shots - Лента снятых фото текущей сессии (Экран 4)
 * @property {string | null} selectedShotId - ID снимка для Side-by-Side сравнения
 * @property {boolean} showSkeletonOverlay - Переключатель скелета поверх фото на Экране 4
 * @property {AppSettings} settings - Пользовательские настройки съемки
 * @property {RuntimeStatus} runtime - Эфемерное состояние камеры, MediaPipe и таймеров
 */
```

## 3. Константы таймингов и порогов
- `AUTO_SHUTTER_HOLD_MS = 800` (удержание позы `>= threshold` 0.8 сек до автоспуска).
- `SHUTTER_COOLDOWN_MS = 2200` (пауза после автоспуска).
- `POSE_RECORD_SECONDS = 3` (отсчет для записи эталонной позы с камеры).
- `VOICE_COOLDOWN_MS = 3200` (минимальный интервал между голосовыми подсказками).
- `JOINT_VISIBILITY_THRESHOLD = 0.35`.
- `GALLERY_MAX_SHOTS = 30` (максимум кадров в ленте сессии, вытеснение старых по LRU).

## 4. Edge Cases (обязательная обработка)
1. **MediaPipe GPU -> CPU fallback и ошибка CDN:** при сбое `delegate: "GPU"` автоматический повтор с `delegate: "CPU"`. При полном отказе — `mpStatus: "error"`, уведомление без падения приложения, ручная калибровка остается доступной.
2. **Человек не найден на загруженном фото:** подставляется `createDefaultSkeleton()`, `autoDetected: false`, на Экране 2 выводится предупреждение для ручной настройки точек.
3. **Запись позы 3 сек без человека в кадре:** если на момент `0` человек не обнаружен, запись отменяется с предупреждением, текущий `activeReference` не затирается.
4. **Выключено слишком много суставов в калибровке:** если активно `< 2` сегментов, `evaluatePose` возвращает `score: 0` и подсказку вместо `NaN` или ложных `100%`.
5. **Отказ/смена камеры:** корректный `track.stop()` предыдущего `MediaStream` перед новым `getUserMedia`, отображение `cameraError` и кнопки повторного запроса доступа.
6. **Переполнение `localStorage`:** при сохранении калибровок перехват `QuotaExceededError` (и сжатие превью-изображения при загрузке фото), чтобы приложение не падало.
7. **Ограничения Web Audio / SpeechSynthesis в браузерах:** разблокировка `AudioContext` только после первого пользовательского жеста; предотвращение наложения реплик через `VOICE_COOLDOWN_MS`.
8. **Зеркалирование передней и задней камеры («Честная передняя камера»):** на задней камере (`facingMode === "environment"`) зеркалирование камеры никогда не применяется (превью и кадр прямые, тумблер в UI `disabled`), при этом пользовательское предпочтение `settings.mirrorFrontCamera` сохраняется при переключении «Передняя → Задняя → Передняя». При неопределённом `facingMode` (десктоп/вебкамера без `label` и явных маркеров задней камеры) камера детерминированно трактуется как передняя (управляемая `mirrorFrontCamera`) со строгой синхронизацией `<video>`, `<canvas>` и `takeShot`.
9. **Память Галереи (`Blob` + `ObjectURL` + LRU):** кадры в `state.shots` хранятся как JPEG `Blob` + `ObjectURL` с ограничением ленты `GALLERY_MAX_SHOTS = 30` (самые старые вытесняются по LRU). При удалении кадра, вытеснении по LRU, полной очистке Галереи и выгрузке вкладки (`beforeunload`, `pagehide` без `persisted`) для `blob:`-URL гарантированно вызывается `URL.revokeObjectURL(...)` после отвязки от DOM. Скачивание JPG использует изолированный временный `ObjectURL`, чтобы не конфликтовать с отображением в ленте.

