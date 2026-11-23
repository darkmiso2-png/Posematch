/**
 * @typedef {Object} JointPoint
 * @property {number} x - Нормализованная координата X [0..1]
 * @property {number} y - Нормализованная координата Y [0..1]
 * @property {number} [z] - Глубина относительно бедер
 * @property {number} [visibility] - Активность/видимость точки [0..1]; < 0.35 считается выключенной
 */

/**
 * @typedef {"preset" | "upload" | "recorded" | "custom"} ReferenceSource
 * @typedef {"all" | "portrait" | "fullbody" | "dynamic" | "saved"} PresetCategory
 * @typedef {"shoulders" | "elbows" | "torso" | "head" | "hips"} SegmentGroup
 *
 * @typedef {Object} PoseReference
 * @property {string} id - Уникальный идентификатор эталона
 * @property {string} name - Отображаемое название позы
 * @property {ReferenceSource} source - Источник создания эталона
 * @property {PresetCategory} category - Категория для фильтра на Главном хабе
 * @property {string} imageDataUrl - Data URL изображения эталона
 * @property {number} aspect - Соотношение сторон width / height исходного кадра
 * @property {JointPoint[]} landmarks - Массив из 33 точек скелета (текущая калибровка)
 * @property {JointPoint[]} autoLandmarks - Исходные точки от MediaPipe (для сброса)
 * @property {boolean} autoDetected - true, если поза найдена нейросетью
 * @property {number} createdAt - Unix timestamp (ms)
 */

/**
 * @typedef {Object} CapturedShot
 * @property {string} id - Уникальный идентификатор снимка
 * @property {string} referenceId - ID эталона PoseReference
 * @property {string} [referenceName] - Название эталона на момент съемки
 * @property {string} [referenceImageDataUrl] - Data URL эталона на момент съемки
 * @property {boolean} [refMirrored] - Был ли включен mirrorRef на момент съемки
 * @property {boolean} [cameraMirrored] - Было ли применено зеркалирование камеры в момент съемки
 * @property {string} imageDataUrl - Чистый JPEG Data URL (с учетом cameraMirrored)
 * @property {number} score - Итоговый процент совпадения (0..100)
 * @property {JointPoint[] | null} userLandmarks - Скелет пользователя в момент спуска
 * @property {JointPoint[] | null} refLandmarks - Эффективный скелет эталона
 * @property {number} createdAt - Unix timestamp (ms)
 */

/**
 * @typedef {"hub" | "calibration" | "camera" | "gallery"} ScreenId
 *
 * @typedef {Object} AppSettings
 * @property {boolean} attachToBody - Режим «К телу»
 * @property {boolean} mirrorRef - Отзеркаливание эталонного скелета
 * @property {boolean} mirrorFrontCamera - Зеркалирование передней камеры (true — «как в зеркале», false — «честный кадр»)
 * @property {boolean} parktronic - Звуковой «Парктроник»
 * @property {boolean} voice - Голосовые подсказки
 * @property {number} threshold - Порог автоспуска (60..95)
 * @property {string} activeDeviceId - ID выбранной камеры
 *
 * @typedef {Object} RuntimeStatus
 * @property {"loading" | "gpu" | "cpu" | "error"} mpStatus - Статус MediaPipe
 * @property {string} mpMessage - Текст статуса нейросети
 * @property {boolean} cameraReady - Активен ли видеопоток
 * @property {string | null} cameraError - Ошибка доступа к камере
 * @property {boolean} isRecordingPose - Идет ли 3-секундный отсчет записи позы
 * @property {number} countdownSec - Остаток секунд (3..1 или 0)
 * @property {number} holdMs - Время удержания позы >= threshold (ms, цель 800)
 * @property {number} shutterCooldownMs - Кулдаун после автоспуска (ms)
 *
 * @typedef {Object} AppState
 * @property {ScreenId} currentScreen - Активный экран
 * @property {PresetCategory} activeFilter - Активный фильтр шаблонов
 * @property {PoseReference[]} presets - Встроенные пресеты
 * @property {PoseReference[]} savedCalibrations - Пользовательские калибровки
 * @property {PoseReference | null} activeReference - Активный эталон для съемки
 * @property {PoseReference | null} draftCalibration - Черновик калибровки (Экран 2)
 * @property {CapturedShot[]} shots - Снимки текущей сессии (Экран 4)
 * @property {string | null} selectedShotId - ID снимка для сравнения
 * @property {boolean} showSkeletonOverlay - Отображение скелета поверх фото в галерее
 * @property {AppSettings} settings - Пользовательские настройки
 * @property {RuntimeStatus} runtime - Эфемерное состояние камеры и таймеров
 */

/**
 * @typedef {Object} SegmentResult
 * @property {string} id
 * @property {SegmentGroup} group
 * @property {number} score
 * @property {boolean} match
 * @property {string} hint
 */

/**
 * @typedef {Object} PoseEvaluation
 * @property {number} totalScore
 * @property {Record<SegmentGroup, number | null>} groupScores
 * @property {Map<string, SegmentResult>} segResults
 * @property {string} worstHint
 */

/**
 * @typedef {Object} SmoothingState
 * @property {boolean} initialized
 * @property {number} cx
 * @property {number} cy
 * @property {number} torsoPx
 */

/**
 * @typedef {Object} TargetPointPx
 * @property {number} x
 * @property {number} y
 * @property {boolean} active
 */

/**
 * @typedef {Object} PresetDefinition
 * @property {string} id - Идентификатор пресета
 * @property {string} name - Название пресета
 * @property {string} badge - Короткий бейдж
 * @property {import("./types.js").PresetCategory} category - Категория фильтра
 * @property {string} accent - Акцентный цвет превью
 * @property {JointPoint[]} landmarks - Массив из 33 точек скелета
 */

export {};
