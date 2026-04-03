import { useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent } from "react";
import "./App.css";
import {
  ApiError,
  authenticateSettingsAccess,
  getColumnTypeConfig,
  exportXlsxToSettings,
  getColumnConfig,
  getFilterConfig,
  getSettings,
  getSettingsSummary,
  getTemplates,
  loadDowntimeFacts,
  saveColumnConfig,
  saveFilterConfig,
  saveColumnTypeConfig,
  saveSettings,
  uploadAnalysisSource,
  uploadFacts,
  type ColumnConfig,
  type ColumnTypeConfig,
  type FilterConfig,
  type LoadResponse,
  type Settings,
  type SettingsSummary,
  type TemplateInfo,
} from "./api";

type TabKey = "facts" | "analysis" | "instructions" | "journal" | "settings";
type FactsSidebarTabKey = "general" | "columns" | "filters" | "types" | "processing";
type NoticeType = "success" | "error" | "info";
type Notice = { id: number; type: NoticeType; text: string };
type JournalEntry = { id: string; title: string; text: string };
type AnalysisMode = "prepare" | "satisfaction";
type ColumnKind = "string" | "number" | "date" | "datetime" | "money";
type NumberFilterOperator = "eq" | "gt" | "lt";
type ColumnFilterState = {
  text: string;
  operator: NumberFilterOperator;
  value: string;
  from: string;
  to: string;
};
type FactsGeneralSettings = {
  defaultWidth: number;
  minWidth: number;
  rowLimit: number;
  hideMoneyCents: boolean;
};
type AnalysisChartType = "pie" | "bar";
type AnalysisAggregation = "count" | "sum";
type AnalysisChartDraft = {
  type: AnalysisChartType;
  pieCategoryColumn: string;
  pieValueColumn: string;
  pieAggregation: AnalysisAggregation;
  pieTitle: string;
  pieShowLabels: boolean;
  pieTopCount: number;
  barCategoryColumn: string;
  barValueColumn: string;
  barAggregation: AnalysisAggregation;
  barTitle: string;
};
type ColumnMoveAnimation = {
  column: string;
  direction: -1 | 1;
  key: number;
};

const DOWNTIME_TEMPLATE_KEY = "downtime";
const DEFAULT_FACTS_PANEL_WIDTH = 320;
const MIN_FACTS_PANEL_WIDTH = 240;
const MAX_FACTS_PANEL_WIDTH = 520;
const DEFAULT_ANALYSIS_PANEL_WIDTH = 220;
const MIN_ANALYSIS_PANEL_WIDTH = 160;
const MAX_ANALYSIS_PANEL_WIDTH = 360;
const DEFAULT_ANALYSIS_CENTER_WIDTH = 520;
const MIN_ANALYSIS_CENTER_WIDTH = 340;
const MAX_ANALYSIS_CENTER_WIDTH = 820;
const DEFAULT_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 60;
const SETTINGS_TOKEN_STORAGE_KEY = "analiz.settingsAccessToken";
const ANALYSIS_PANEL_VISIBLE_STORAGE_KEY = "analiz.analysisPanelVisible";
const ANALYSIS_PANEL_WIDTH_STORAGE_KEY = "analiz.analysisPanelWidth";
const COLUMN_WIDTHS_STORAGE_KEY_PREFIX = "analiz.columnWidths";
const JOURNAL_STORAGE_KEY = "analiz.journalEntries";
const SEED_JOURNAL_ENTRIES: JournalEntry[] = [
  {
    id: "2026-04-03T16:42:00",
    title: "03.04.2026 16:42:00",
    text: [
      "Экран 'Анализ' переведен в почти полноширинный режим.",
      "- Для рабочей области анализа дополнительно убраны верхний, правый и нижний внешние отступы.",
      "- Режим сделан локально только для вкладки 'Анализ' и не влияет на другие разделы.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T16:36:00",
    title: "03.04.2026 16:36:00",
    text: [
      "Сдвинута рабочая область вкладки 'Анализ' ближе к левому краю.",
      "- Для экрана анализа уменьшен только левый внутренний отступ рабочей области.",
      "- Остальные вкладки сохранены без изменений по внешним отступам.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T16:24:00",
    title: "03.04.2026 16:24:00",
    text: [
      "Сокращен зазор между левой панелью анализа и остальной частью экрана.",
      "- Убран общий промежуток между левой панелью и правым блоком анализа.",
      "- Разделитель изменения ширины сужен до минимально достаточного размера.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T16:15:00",
    title: "03.04.2026 16:15:00",
    text: [
      "Локально уплотнены панели вкладки 'Анализ'.",
      "- Для panel-блоков экрана анализа уменьшены внутренние отступы без изменения глобального класса .panel.",
      "- Остальные вкладки приложения сохранены без визуальных изменений.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T16:08:00",
    title: "03.04.2026 16:08:00",
    text: [
      "Уплотнены внешние отступы и верхняя панель вкладки 'Анализ'.",
      "- Уменьшены расстояния между панелями и рабочей областью экрана.",
      "- Сокращены промежутки между левой, верхней, центральной и правой панелями.",
      "- Кнопки в верхней панели анализа сделаны компактнее по внутренним отступам.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T15:59:00",
    title: "03.04.2026 15:59:00",
    text: [
      "Дополнительно уплотнена центральная панель вкладки 'Анализ'.",
      "- Убран tooltip с названий полей управления графиком.",
      "- Удалён пустой верхний контейнер центральной панели.",
      "- Сокращены интервалы в легенде, строках диаграммы и правой панели данных.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T15:48:00",
    title: "03.04.2026 15:48:00",
    text: [
      "Добавлены кастомные подсказки и уплотнена центральная панель вкладки 'Анализ'.",
      "- Для подписей и самих полей управления графиком включены собственные tooltip-подсказки.",
      "- Tooltip теперь показывает полное название поля и текущее значение элемента управления.",
      "- Сокращены вертикальные и горизонтальные промежутки между элементами центральной панели.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T15:31:00",
    title: "03.04.2026 15:31:00",
    text: [
      "Стабилизирована центральная панель вкладки 'Анализ'.",
      "- Верхняя панель теперь показывает упрощенную текстовую строку с файлом и количеством строк.",
      "- Блок параметров графика переведен в фиксированную трехколоночную сетку с собственным горизонтальным скроллом.",
      "- Устранено наложение подписей на поля при сужении центральной панели.",
      "- Кнопка 'Построить' дополнительно расширена.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T15:14:00",
    title: "03.04.2026 15:14:00",
    text: [
      "Уточнены названия и поведение элементов на вкладке 'Анализ'.",
      "- Пункты левой панели переименованы в 'Простой' и 'Клиент'.",
      "- Для обрезаемых надписей добаван показ полного текста при наведении.",
      "- Чекбокс 'Показывать подписи' переименован в 'Подписи'.",
      "- Кнопка показа левой панели перенесена в analysis-topbar.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T15:02:00",
    title: "03.04.2026 15:02:00",
    text: [
      "Уточнена компоновка элементов на вкладке 'Анализ'.",
      "- Ширина полей управления графиком увеличена до 90 px.",
      "- Элементы управления в центральной панели теперь выводятся по 3 в ряд с более плотными вертикальными отступами.",
      "- Кнопка 'Построить' расширена до 75 px.",
      "- Радиокнопки в левой панели выровнены в классическом виде: кружок слева, подпись справа.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T14:49:00",
    title: "03.04.2026 14:49:00",
    text: [
      "Уточнено расположение элементов управления на вкладке 'Анализ'.",
      "- Кнопка 'Скрыть' перенесена из левой панели в верхнюю панель управления.",
      "- Для подписей полей управления графиком задана фиксированная ширина.",
      "- Поля ввода и выпадающие списки придвинуты ближе к своим подписям.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T14:41:00",
    title: "03.04.2026 14:41:00",
    text: [
      "Обновлена верхняя панель вкладки 'Анализ' и компактность элементов управления графиком.",
      "- Кнопки 'Загрузить данные' и 'Обработать' перенесены в analysis-topbar.",
      "- Поля 'Тип', 'Категория', 'Агрегация', 'Заголовок' и 'Топ категорий' получили фиксированную ширину и подписи слева.",
      "- Кнопка 'Построить' стала компактной фиксированной ширины.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T14:26:00",
    title: "03.04.2026 14:26:00",
    text: [
      "Перестроен layout вкладки 'Анализ'.",
      "- Левая панель анализа теперь тянется на всю высоту рабочей области.",
      "- Верхняя панель анализа перенесена в правую часть и теперь занимает всю ширину над центральной и правой панелями.",
      "- Центральная и правая панели расположены под верхней панелью справа от левого блока.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T14:02:00",
    title: "03.04.2026 14:02:00",
    text: [
      "Исправлено вычисление отображаемого порядка столбцов в таблице 'Данные'.",
      "- Таблица теперь берёт порядок отображения из пользовательского списка выбранных столбцов, а не из исходного порядка заголовков файла.",
      "- После нажатия на стрелки столбец должен менять место сразу и визуально оставаться на новой позиции.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T13:44:00",
    title: "03.04.2026 13:44:00",
    text: [
      "Исправлена отрисовка порядка столбцов в таблице 'Данные'.",
      "- Таблица больше не возвращает столбцы в исходный порядок файла после нажатия на стрелки.",
      "- Перестановка теперь видна сразу после клика: столбец меняет место немедленно.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T13:31:00",
    title: "03.04.2026 13:31:00",
    text: [
      "Добавлена анимация при перестановке столбцов в таблице 'Данные'.",
      "- После нажатия на стрелки переставляемый столбец кратко подсвечивается и смещается в сторону движения.",
      "- Анимация сделана лёгкой, чтобы движение было заметнее без лишней нагрузки на интерфейс.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T13:18:00",
    title: "03.04.2026 13:18:00",
    text: [
      "Исправлено управление порядком столбцов в таблице 'Данные'.",
      "- Кнопки перемещения столбцов теперь не съедают место у заголовка и показываются только при наведении на столбец.",
      "- Перемещение столбцов теперь применяется сразу в таблице без дополнительной кнопки 'Применить'.",
      "- Новый порядок столбцов автоматически сохраняется между сессиями для текущего шаблона.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T12:41:13",
    title: "03.04.2026 12:41:13",
    text: [
      "Упрощено отображение даты в таблице 'Данные' и добавлено автосохранение ширины столбцов.",
      "- Для явно выбранного типа 'Дата' значения отображаются в формате dd.MM.yy.",
      "- Для явно выбранного типа 'Дата/время' значения отображаются в формате dd.MM.yy HH:mm.",
      "- Если тип даты не выбран явно или значение не удалось распарсить, в таблице показывается исходное значение из файла.",
      "- Ширина столбцов теперь сохраняется автоматически после изменения и восстанавливается между сессиями без нажатия кнопки 'Сохранить конфигурацию'.",
      "- Ручное сохранение конфигурации столбцов сохранено для набора столбцов и остальных настроек.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T12:11:34",
    title: "03.04.2026 12:11:34",
    text: [
      "Улучшено отображение вкладок панели данных и поведение списка строк.",
      "- Подписи вкладок 'Общие', 'Столбцы', 'Фильтры', 'Типы', 'Обработка' теперь обрезаются границей кнопки и не заходят на соседние вкладки.",
      "- Сохраненная конфигурация столбцов теперь автоматически применяется после новой загрузки данных и после перезапуска сессии для выбранного шаблона.",
      "- По умолчанию после загрузки на экран выводится не более 10 строк.",
      "- В закладке 'Общие' добавлена кнопка 'Показать все строки', которая снимает лимит строк на экране, сохраняя все текущие фильтры и ограничения отображения.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T11:52:04",
    title: "03.04.2026 11:52:04",
    text: [
      "Добавлен предпросмотр результата парсинга и откат последнего парсинга.",
      "- Во вкладке 'Обработка' перед запуском показывается, сколько строк будет создано после парсинга видимых данных.",
      "- Добавлена кнопка отката последнего парсинга в текущей сессии.",
      "- Откат возвращает таблицу 'Данные' к состоянию до последнего парсинга.",
      "- История отката очищается при новой загрузке файла, автозагрузке шаблона 'Простои' и при очистке экрана.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T11:48:56",
    title: "03.04.2026 11:48:56",
    text: [
      "Изменен алгоритм парсинга во вкладке 'Обработка'.",
      "- Поле 'Параметр' переименовано в 'Разделитель'.",
      "- Кнопка 'Парсинг' теперь изменяет строки в таблице 'Данные' только для текущей сессии.",
      "- Парсинг применяется только к строкам, которые сейчас видны в таблице 'Данные'.",
      "- Если в выбранном столбце найден разделитель, исходная строка заменяется набором строк-копий, где меняется только значение выбранного столбца.",
      "- Пустые части после разделения сохраняются как отдельные строки, а пробелы по краям частей обрезаются.",
      "- Скрытые строки остаются без изменений, а повторный парсинг выполняется уже по результату предыдущего парсинга.",
    ].join("\n"),
  },
  {
    id: "2026-04-03T11:34:15",
    title: "03.04.2026 11:34:15",
    text: [
      "Обновлена вкладка 'Обработка' и добавлен журнал изменений.",
      "- Чекбоксы во вкладке 'Обработка' заменены на радиокнопки.",
      "- Для сценария 'Парсинг Провалы' скрыт блок 'Режим' и оставлены поля 'Столбец из данных', 'Параметр' и кнопка 'Парсинг'.",
      "- Кнопка 'Парсинг' разбивает значения выбранного столбца по указанному разделителю и добавляет новые столбцы в таблицу данных.",
      "- Ширина вкладок панели данных уменьшена примерно на 20%.",
      "- Добавлена верхняя вкладка 'Журнал' с записью изменений и временем создания записи.",
    ].join("\n"),
  },
];
const DEFAULT_FACTS_GENERAL_SETTINGS: FactsGeneralSettings = {
  defaultWidth: DEFAULT_COLUMN_WIDTH,
  minWidth: MIN_COLUMN_WIDTH,
  rowLimit: 10,
  hideMoneyCents: false,
};
const DEFAULT_ANALYSIS_CHART_DRAFT: AnalysisChartDraft = {
  type: "pie",
  pieCategoryColumn: "",
  pieValueColumn: "",
  pieAggregation: "count",
  pieTitle: "Круговая диаграмма",
  pieShowLabels: true,
  pieTopCount: 8,
  barCategoryColumn: "",
  barValueColumn: "",
  barAggregation: "count",
  barTitle: "Столбиковая диаграмма",
};
const ANALYSIS_CHART_COLORS = [
  "#2d6cdf",
  "#e77d35",
  "#24936e",
  "#b9465a",
  "#6c5ce7",
  "#b88a14",
  "#15808a",
  "#6f7f2b",
  "#c457b5",
  "#5478a6",
];

function getAnalysisChartTypeLabel(type: AnalysisChartType): string {
  return type === "pie" ? "Пирог" : "Столбиковая";
}

function getAnalysisAggregationLabel(aggregation: AnalysisAggregation): string {
  return aggregation === "sum" ? "Сумма по столбцу" : "Количество строк";
}

function getTooltipValue(value: string | number | undefined | null, emptyLabel = "не выбрано"): string {
  const normalized = String(value ?? "").trim();
  return normalized || emptyLabel;
}

function orderColumnsByHeaders(headers: string[], columns: string[]): string[] {
  const allowedHeaders = new Set(headers);
  return columns.filter((column) => allowedHeaders.has(column));
}

function normalizeColumnWidths(widths: Record<string, number>, columns: string[]): Record<string, number> {
  const allowedColumns = new Set(columns);
  return Object.fromEntries(
    Object.entries(widths)
      .map(([column, width]) => [column, Math.round(width)] as const)
      .filter(([column, width]) => allowedColumns.has(column) && Number.isFinite(width) && width > 0),
  );
}

function areColumnListsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((column, index) => column === right[index]);
}

function areGeneralSettingsEqual(left: FactsGeneralSettings, right: FactsGeneralSettings): boolean {
  return (
    left.defaultWidth === right.defaultWidth
    && left.minWidth === right.minWidth
    && left.rowLimit === right.rowLimit
    && left.hideMoneyCents === right.hideMoneyCents
  );
}

function sanitizeGeneralSettings(value?: Partial<FactsGeneralSettings> | null): FactsGeneralSettings {
  const minWidth = Math.max(MIN_COLUMN_WIDTH, Math.round(value?.minWidth ?? DEFAULT_FACTS_GENERAL_SETTINGS.minWidth));
  const defaultWidth = Math.max(minWidth, Math.round(value?.defaultWidth ?? DEFAULT_FACTS_GENERAL_SETTINGS.defaultWidth));
  const rowLimit = Math.max(0, Math.round(value?.rowLimit ?? DEFAULT_FACTS_GENERAL_SETTINGS.rowLimit));
  return {
    defaultWidth,
    minWidth,
    rowLimit,
    hideMoneyCents: Boolean(value?.hideMoneyCents),
  };
}

function toColumnConfigGeneral(settings: FactsGeneralSettings): ColumnConfig["general"] {
  return {
    default_width: settings.defaultWidth,
    min_width: settings.minWidth,
    row_limit: settings.rowLimit,
    hide_money_cents: settings.hideMoneyCents,
  };
}

function fromColumnConfigGeneral(general?: Partial<ColumnConfig["general"]> | null): FactsGeneralSettings {
  return sanitizeGeneralSettings({
    defaultWidth: general?.default_width,
    minWidth: general?.min_width,
    rowLimit: general?.row_limit,
    hideMoneyCents: general?.hide_money_cents,
  });
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const rawValue = window.localStorage.getItem(key);
  if (rawValue === null) {
    return fallback;
  }
  return rawValue === "true";
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  const rawValue = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(rawValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, rawValue));
}

function getColumnWidthsStorageKey(templateKey: string): string {
  return `${COLUMN_WIDTHS_STORAGE_KEY_PREFIX}.${templateKey}`;
}

function readStoredColumnWidths(templateKey: string, headers: string[]): Record<string, number> {
  if (!templateKey) {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(getColumnWidthsStorageKey(templateKey));
    if (!rawValue) {
      return {};
    }
    return normalizeColumnWidths(JSON.parse(rawValue) as Record<string, number>, headers);
  } catch {
    return {};
  }
}

function formatShortDate(value: Date): string {
  return `${String(value.getDate()).padStart(2, "0")}.${String(value.getMonth() + 1).padStart(2, "0")}.${String(value.getFullYear()).slice(-2)}`;
}

function formatShortDateTime(value: Date): string {
  return `${formatShortDate(value)} ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function mergeSeedJournalEntries(entries: JournalEntry[]): JournalEntry[] {
  const existingIds = new Set(entries.map((entry) => entry.id));
  const missingSeedEntries = SEED_JOURNAL_ENTRIES.filter((entry) => !existingIds.has(entry.id));
  return [...missingSeedEntries, ...entries];
}

function createTimestampedFileName(prefix: string): string {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `${prefix}_${parts[0]}${parts[1]}${parts[2]}_${parts[3]}${parts[4]}${parts[5]}`;
}

function normalizeExpectedType(expectedType?: string): ColumnKind | null {
  const value = (expectedType || "").trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (["int", "integer", "float", "double", "decimal", "number"].includes(value)) {
    return "number";
  }
  if (["datetime", "timestamp"].includes(value)) {
    return "datetime";
  }
  if (value === "date") {
    return "date";
  }
  if (["money", "currency", "денежный"].includes(value)) {
    return "money";
  }
  return "string";
}

function defaultFilterState(): ColumnFilterState {
  return {
    text: "",
    operator: "eq",
    value: "",
    from: "",
    to: "",
  };
}

function normalizeFilterConfig(filters: FilterConfig["filters"] | Record<string, ColumnFilterState> | undefined): Record<string, ColumnFilterState> {
  if (!filters) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(filters).map(([header, filter]) => [
      header,
      {
        text: String(filter.text ?? ""),
        operator: (filter.operator === "gt" || filter.operator === "lt" ? filter.operator : "eq") as NumberFilterOperator,
        value: String(filter.value ?? ""),
        from: String(filter.from ?? ""),
        to: String(filter.to ?? ""),
      },
    ]),
  );
}

function mergeFiltersWithHeaders(
  headers: string[],
  filters: Record<string, ColumnFilterState>,
): Record<string, ColumnFilterState> {
  return Object.fromEntries(
    headers.map((header) => [header, filters[header] ?? defaultFilterState()]),
  );
}

function areFilterStatesEqual(
  left: Record<string, ColumnFilterState>,
  right: Record<string, ColumnFilterState>,
  headers: string[],
): boolean {
  return headers.every((header) => {
    const leftValue = left[header] ?? defaultFilterState();
    const rightValue = right[header] ?? defaultFilterState();
    return (
      leftValue.text === rightValue.text
      && leftValue.operator === rightValue.operator
      && leftValue.value === rightValue.value
      && leftValue.from === rightValue.from
      && leftValue.to === rightValue.to
    );
  });
}

function parseNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const isoDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const isoDateTimeMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (isoDateTimeMatch) {
    const [, year, month, day, hours, minutes, seconds = "00"] = isoDateTimeMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const nativeParsed = new Date(raw);
  if (!Number.isNaN(nativeParsed.getTime())) {
    return nativeParsed;
  }

  const dateTimeMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!dateTimeMatch) {
    return null;
  }

  const [, day, month, year, hours = "00", minutes = "00", seconds = "00"] = dateTimeMatch;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function inferColumnKind(values: unknown[]): ColumnKind {
  const sample = values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value !== "")
    .slice(0, 20);

  if (!sample.length) {
    return "string";
  }

  let numberMatches = 0;
  let dateMatches = 0;
  let dateTimeMatches = 0;

  sample.forEach((value) => {
    if (parseNumberValue(value) !== null) {
      numberMatches += 1;
    }
    const parsedDate = parseDateValue(value);
    if (parsedDate) {
      dateMatches += 1;
      if (/\d{2}:\d{2}/.test(value) || parsedDate.getHours() !== 0 || parsedDate.getMinutes() !== 0) {
        dateTimeMatches += 1;
      }
    }
  });

  if (dateMatches >= Math.max(2, Math.ceil(sample.length * 0.6))) {
    return dateTimeMatches > 0 ? "datetime" : "date";
  }
  if (numberMatches >= Math.max(2, Math.ceil(sample.length * 0.7))) {
    return "number";
  }
  return "string";
}

function formatMoneyValue(value: unknown, hideMoneyCents: boolean): string {
  const parsed = parseNumberValue(value);
  if (parsed === null) {
    return String(value ?? "");
  }

  const normalized = hideMoneyCents ? Math.trunc(parsed) : parsed;
  const hasFraction = !hideMoneyCents && Math.abs(normalized % 1) > 0.000001;

  const formatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });

  return `${formatter.format(normalized)} р.`;
}

function formatCellValue(
  value: unknown,
  kind: ColumnKind,
  explicitType: string | undefined,
  generalSettings: FactsGeneralSettings,
): string {
  if (explicitType === "date" || explicitType === "datetime") {
    const parsedDate = parseDateValue(value);
    if (!parsedDate) {
      return String(value ?? "");
    }
    return explicitType === "date" ? formatShortDate(parsedDate) : formatShortDateTime(parsedDate);
  }

  if (kind === "money") {
    return formatMoneyValue(value, generalSettings.hideMoneyCents);
  }
  return String(value ?? "");
}

function cloneAnalysisChartDraft(draft: AnalysisChartDraft): AnalysisChartDraft {
  return { ...draft };
}

function aggregateChartRows(
  rows: Record<string, unknown>[],
  categoryColumn: string,
  aggregation: AnalysisAggregation,
  valueColumn: string,
): Array<{ label: string; value: number }> {
  const grouped = new Map<string, number>();

  rows.forEach((row) => {
    const label = String(row[categoryColumn] ?? "").trim() || "(Пусто)";
    const currentValue = grouped.get(label) ?? 0;

    if (aggregation === "count") {
      grouped.set(label, currentValue + 1);
      return;
    }

    const numericValue = parseNumberValue(row[valueColumn]);
    if (numericValue === null) {
      return;
    }
    grouped.set(label, currentValue + numericValue);
  });

  return [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .sort((left, right) => right.value - left.value);
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describePieArc(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function App() {
  const factsBodyRef = useRef<HTMLDivElement | null>(null);
  const analysisBodyRef = useRef<HTMLDivElement | null>(null);
  const analysisWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const analysisFileInputRef = useRef<HTMLInputElement | null>(null);
  const dataTableBottomScrollRef = useRef<HTMLDivElement | null>(null);
  const dataTableTopScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("facts");
  const [settings, setSettings] = useState<Settings>({ db_path_1: "", db_path_2: "" });
  const [settingsSummary, setSettingsSummary] = useState<SettingsSummary>({ has_db_path_1: false, has_db_path_2: false });
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [settingsAccessToken, setSettingsAccessToken] = useState(() => window.localStorage.getItem(SETTINGS_TOKEN_STORAGE_KEY) ?? "");
  const [settingsAuthorized, setSettingsAuthorized] = useState(false);

  const [loadResult, setLoadResult] = useState<LoadResponse | null>(null);
  const [lastParseSnapshot, setLastParseSnapshot] = useState<LoadResponse | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("prepare");
  const [analysisLoadResult, setAnalysisLoadResult] = useState<LoadResponse | null>(null);
  const [analysisSourceFile, setAnalysisSourceFile] = useState<File | null>(null);
  const [analysisChartDraft, setAnalysisChartDraft] = useState<AnalysisChartDraft>(DEFAULT_ANALYSIS_CHART_DRAFT);
  const [analysisChartApplied, setAnalysisChartApplied] = useState<AnalysisChartDraft | null>(null);

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [analysisTooltip, setAnalysisTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [journalEntries] = useState<JournalEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(JOURNAL_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const entries = Array.isArray(parsed)
        ? parsed.filter((entry): entry is JournalEntry => (
          Boolean(entry)
          && typeof entry.id === "string"
          && typeof entry.title === "string"
          && typeof entry.text === "string"
        ))
        : [];

      return mergeSeedJournalEntries(entries);
    } catch {
      return SEED_JOURNAL_ENTRIES;
    }
  });
  const [factsSidebarTab, setFactsSidebarTab] = useState<FactsSidebarTabKey>("columns");

  // Processing tab state
  type ProcessingSettings = {
    selectedOption: "parseReason" | "option2";
    mode: string;
    parseReasonColumn: string;
    param: string;
  };
  const DEFAULT_PROCESSING_SETTINGS: ProcessingSettings = {
    selectedOption: "parseReason",
    mode: "mode1",
    parseReasonColumn: "",
    param: "",
  };
  const [processingSettings, setProcessingSettings] = useState<ProcessingSettings>(DEFAULT_PROCESSING_SETTINGS);
  const [savedProcessingSettings, setSavedProcessingSettings] = useState<ProcessingSettings>(DEFAULT_PROCESSING_SETTINGS);

  function normalizeProcessingSettings(raw: unknown): ProcessingSettings {
    const value = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
    const selectedOption = value.selectedOption === "option2"
      ? "option2"
      : value.option2 === true && value.option1 !== true
        ? "option2"
        : "parseReason";

    return {
      selectedOption,
      mode: typeof value.mode === "string" && value.mode.trim() ? value.mode : DEFAULT_PROCESSING_SETTINGS.mode,
      parseReasonColumn: typeof value.parseReasonColumn === "string" ? value.parseReasonColumn : "",
      param: typeof value.param === "string" ? value.param : "",
    };
  }

  // Сохранять/загружать настройки обработки по шаблону
  useEffect(() => {
    window.localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(journalEntries));
  }, [journalEntries]);

  useEffect(() => {
    if (!templateKey) return;
    const raw = window.localStorage.getItem(`analiz.processing.${templateKey}`);
    if (raw) {
      try {
        const normalized = normalizeProcessingSettings(JSON.parse(raw));
        setProcessingSettings(normalized);
        setSavedProcessingSettings(normalized);
      } catch {}
    } else {
      setProcessingSettings(DEFAULT_PROCESSING_SETTINGS);
      setSavedProcessingSettings(DEFAULT_PROCESSING_SETTINGS);
    }
  }, [templateKey]);

  function saveProcessingSettings() {
    if (!templateKey) return;
    window.localStorage.setItem(`analiz.processing.${templateKey}`, JSON.stringify(processingSettings));
    setSavedProcessingSettings(processingSettings);
    setStatus("Настройки обработки сохранены.");
    pushNotice("success", "Настройки обработки сохранены.");
  }

  function restoreProcessingSettings() {
    setProcessingSettings(savedProcessingSettings);
    setStatus("Сохранённые настройки обработки применены.");
    pushNotice("success", "Сохранённые настройки обработки применены.");
  }

  function showAllFactRows() {
    setFactsGeneralSettings((current) => ({ ...current, rowLimit: 0 }));
    setDraftFactsGeneralSettings((current) => ({ ...current, rowLimit: 0 }));
    setStatus("Лимит строк снят. На экране показаны все строки с учетом текущих фильтров.");
    pushNotice("success", "Лимит строк снят.");
  }

  function undoLastProcessingParse() {
    if (!lastParseSnapshot) {
      setStatus("Нет парсинга для отката.");
      pushNotice("info", "Нет парсинга для отката.");
      return;
    }

    setLoadResult(lastParseSnapshot);
    setLastParseSnapshot(null);
    setStatus("Последний парсинг отменён.");
    pushNotice("success", "Последний парсинг отменён.");
  }

  function runProcessingParse() {
    if (!loadResult?.rows?.length) {
      setStatus("Нет данных для парсинга.");
      pushNotice("info", "Нет данных для парсинга.");
      return;
    }

    if (processingSettings.selectedOption !== "parseReason") {
      setStatus("Включите 'Парсинг Провалы'.");
      pushNotice("info", "Включите 'Парсинг Провалы'.");
      return;
    }

    const targetColumn = processingSettings.parseReasonColumn.trim();
    if (!targetColumn) {
      setStatus("Выберите столбец для парсинга.");
      pushNotice("info", "Выберите столбец для парсинга.");
      return;
    }

    const delimiter = processingSettings.param.trim();
    if (!delimiter) {
      setStatus("Укажите разделитель в поле 'Разделитель'.");
      pushNotice("info", "Укажите разделитель в поле 'Разделитель'.");
      return;
    }

    const visibleRows = displayedFactRows;
    const hasParsableRow = visibleRows.some((row) => String(row[targetColumn] ?? "").includes(delimiter));
    if (!hasParsableRow) {
      setStatus("Среди видимых строк нет данных для парсинга по указанному разделителю.");
      pushNotice("info", "Среди видимых строк нет данных для парсинга по указанному разделителю.");
      return;
    }

    const visibleRowsSet = new Set(visibleRows);
    const nextRows = loadResult.rows.flatMap((row) => {
      if (!visibleRowsSet.has(row)) {
        return [row];
      }

      const rawValue = String(row[targetColumn] ?? "");
      if (!rawValue.includes(delimiter)) {
        return [row];
      }

      return rawValue.split(delimiter).map((part) => ({
        ...row,
        [targetColumn]: part.trim(),
      }));
    });

    setLastParseSnapshot(loadResult);
    setLoadResult({
      ...loadResult,
      rows: nextRows,
    });
    setStatus(`Парсинг выполнен для столбца '${targetColumn}'. Видимые строки обновлены.`);
    pushNotice("success", `Парсинг выполнен для столбца '${targetColumn}'.`);
  }
  const [visibleFactColumns, setVisibleFactColumns] = useState<string[]>([]);
  const [draftVisibleFactColumns, setDraftVisibleFactColumns] = useState<string[]>([]);
  const [savedColumnConfig, setSavedColumnConfig] = useState<ColumnConfig | null>(null);
  const [savedColumnTypeConfig, setSavedColumnTypeConfig] = useState<ColumnTypeConfig | null>(null);
  const [savedFilterConfig, setSavedFilterConfig] = useState<FilterConfig | null>(null);
  const [factsGeneralSettings, setFactsGeneralSettings] = useState<FactsGeneralSettings>(DEFAULT_FACTS_GENERAL_SETTINGS);
  const [draftFactsGeneralSettings, setDraftFactsGeneralSettings] = useState<FactsGeneralSettings>(DEFAULT_FACTS_GENERAL_SETTINGS);
  const [columnTypeOverrides, setColumnTypeOverrides] = useState<Record<string, string>>({});
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterState>>({});
  const [draftColumnFilters, setDraftColumnFilters] = useState<Record<string, ColumnFilterState>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [factsPanelVisible, setFactsPanelVisible] = useState(true);
  const [factsPanelWidth, setFactsPanelWidth] = useState(DEFAULT_FACTS_PANEL_WIDTH);
  const [factsPanelResizing, setFactsPanelResizing] = useState(false);
  const [analysisPanelVisible, setAnalysisPanelVisible] = useState(() => readStoredBoolean(ANALYSIS_PANEL_VISIBLE_STORAGE_KEY, true));
  const [analysisPanelWidth, setAnalysisPanelWidth] = useState(() => readStoredNumber(
    ANALYSIS_PANEL_WIDTH_STORAGE_KEY,
    DEFAULT_ANALYSIS_PANEL_WIDTH,
    MIN_ANALYSIS_PANEL_WIDTH,
    MAX_ANALYSIS_PANEL_WIDTH,
  ));
  const [analysisPanelResizing, setAnalysisPanelResizing] = useState(false);
  const [analysisCenterWidth, setAnalysisCenterWidth] = useState(DEFAULT_ANALYSIS_CENTER_WIDTH);
  const [analysisCenterResizing, setAnalysisCenterResizing] = useState(false);
  const [activeColumnResize, setActiveColumnResize] = useState<{ column: string; startX: number; startWidth: number } | null>(null);
  const [columnMoveAnimation, setColumnMoveAnimation] = useState<ColumnMoveAnimation | null>(null);

  const hasRoute = settingsSummary.has_db_path_1;
  const templateOptions = templates;
  const loadHeaders = useMemo(() => loadResult?.headers ?? [], [loadResult]);
  const isDowntimeTemplate = templateKey === DOWNTIME_TEMPLATE_KEY;
  const selectedTemplate = templateOptions.find((t) => t.key === templateKey);
  const templateExpectedTypes = useMemo(() => {
    const out: Record<string, ColumnKind> = {};
    (selectedTemplate?.columns ?? []).forEach((column) => {
      const normalized = normalizeExpectedType(column.expected_type);
      if (normalized) {
        out[column.name] = normalized;
      }
    });
    return out;
  }, [selectedTemplate]);

  const resolvedColumnKinds = useMemo(() => {
    const rows = loadResult?.rows ?? [];
    const kinds: Record<string, ColumnKind> = {};

    loadHeaders.forEach((header) => {
      const savedKind = normalizeExpectedType(columnTypeOverrides[header]);
      if (savedKind) {
        kinds[header] = savedKind;
        return;
      }

      if (templateExpectedTypes[header]) {
        kinds[header] = templateExpectedTypes[header];
        return;
      }

      const columnValues = rows.map((row) => row[header]);
      kinds[header] = inferColumnKind(columnValues);
    });

    return kinds;
  }, [columnTypeOverrides, loadHeaders, loadResult, templateExpectedTypes]);

  const selectedFactColumns = useMemo(() => {
    if (!loadHeaders.length) {
      return [];
    }
    return orderColumnsByHeaders(loadHeaders, visibleFactColumns);
  }, [loadHeaders, visibleFactColumns]);

  const hasPendingColumnSelectionChanges = useMemo(() => {
    return !areColumnListsEqual(orderColumnsByHeaders(loadHeaders, draftVisibleFactColumns), selectedFactColumns);
  }, [draftVisibleFactColumns, loadHeaders, selectedFactColumns]);

  const hasPendingGeneralSettingsChanges = useMemo(() => {
    return !areGeneralSettingsEqual(
      sanitizeGeneralSettings(draftFactsGeneralSettings),
      sanitizeGeneralSettings(factsGeneralSettings),
    );
  }, [draftFactsGeneralSettings, factsGeneralSettings]);

  const hasPendingFilterChanges = useMemo(() => {
    return !areFilterStatesEqual(draftColumnFilters, columnFilters, loadHeaders);
  }, [columnFilters, draftColumnFilters, loadHeaders]);

  const filteredFactRows = useMemo(() => {
    const rows = loadResult?.rows ?? [];
    return rows.filter((row) => {
      return loadHeaders.every((header) => {
        const filter = columnFilters[header] ?? defaultFilterState();
        const rawValue = row[header];
        const kind = resolvedColumnKinds[header] ?? "string";

        if (kind === "number" || kind === "money") {
          if (!filter.value.trim()) {
            return true;
          }
          const rowNumber = parseNumberValue(rawValue);
          const filterNumber = parseNumberValue(filter.value);
          if (rowNumber === null || filterNumber === null) {
            return false;
          }
          if (filter.operator === "gt") {
            return rowNumber > filterNumber;
          }
          if (filter.operator === "lt") {
            return rowNumber < filterNumber;
          }
          return rowNumber === filterNumber;
        }

        if (kind === "date" || kind === "datetime") {
          if (!filter.from && !filter.to) {
            return true;
          }
          const parsedRowDate = parseDateValue(rawValue);
          const rowDate = parsedRowDate ? (kind === "date" ? startOfDay(parsedRowDate) : parsedRowDate) : null;
          if (!rowDate) {
            return false;
          }
          if (filter.from) {
            const fromDate = parseDateValue(filter.from);
            const normalizedFromDate = fromDate ? (kind === "date" ? startOfDay(fromDate) : fromDate) : null;
            if (normalizedFromDate && rowDate < normalizedFromDate) {
              return false;
            }
          }
          if (filter.to) {
            const toDate = parseDateValue(filter.to);
            const normalizedToDate = toDate ? (kind === "date" ? endOfDay(toDate) : toDate) : null;
            if (normalizedToDate && rowDate > normalizedToDate) {
              return false;
            }
          }
          return true;
        }

        if (!filter.text.trim()) {
          return true;
        }
        return String(rawValue ?? "").toLowerCase().includes(filter.text.trim().toLowerCase());
      });
    });
  }, [columnFilters, loadHeaders, loadResult, resolvedColumnKinds]);

  const displayedFactRows = useMemo(() => {
    const rowLimit = factsGeneralSettings.rowLimit;
    if (!rowLimit) {
      return filteredFactRows;
    }
    return filteredFactRows.slice(0, rowLimit);
  }, [factsGeneralSettings.rowLimit, filteredFactRows]);

  const canRunProcessingParse = useMemo(() => {
    if (processingSettings.selectedOption !== "parseReason") {
      return false;
    }

    const targetColumn = processingSettings.parseReasonColumn.trim();
    const delimiter = processingSettings.param.trim();
    if (!targetColumn || !delimiter || !displayedFactRows.length) {
      return false;
    }

    return displayedFactRows.some((row) => String(row[targetColumn] ?? "").includes(delimiter));
  }, [displayedFactRows, processingSettings.param, processingSettings.parseReasonColumn, processingSettings.selectedOption]);

  const processingParsePreview = useMemo(() => {
    if (processingSettings.selectedOption !== "parseReason") {
      return { parsableRows: 0, createdRows: 0, addedRows: 0 };
    }

    const targetColumn = processingSettings.parseReasonColumn.trim();
    const delimiter = processingSettings.param.trim();
    if (!targetColumn || !delimiter || !displayedFactRows.length) {
      return { parsableRows: 0, createdRows: 0, addedRows: 0 };
    }

    let parsableRows = 0;
    let createdRows = 0;

    displayedFactRows.forEach((row) => {
      const rawValue = String(row[targetColumn] ?? "");
      if (!rawValue.includes(delimiter)) {
        return;
      }
      parsableRows += 1;
      createdRows += rawValue.split(delimiter).length;
    });

    return {
      parsableRows,
      createdRows,
      addedRows: Math.max(0, createdRows - parsableRows),
    };
  }, [displayedFactRows, processingSettings.param, processingSettings.parseReasonColumn, processingSettings.selectedOption]);

  function getEffectiveColumnWidth(header: string): number {
    return Math.max(
      factsGeneralSettings.minWidth,
      columnWidths[header] ?? factsGeneralSettings.defaultWidth,
    );
  }

  const totalDataTableWidth = useMemo(() => {
    if (!selectedFactColumns.length) {
      return 0;
    }
    return selectedFactColumns.reduce((total, header) => total + getEffectiveColumnWidth(header), 0);
  }, [columnWidths, factsGeneralSettings.defaultWidth, factsGeneralSettings.minWidth, selectedFactColumns]);

  const displayedFactExportRows = useMemo(
    () => displayedFactRows.map((row) => Object.fromEntries(
      selectedFactColumns.map((header) => [
        header,
        formatCellValue(row[header], resolvedColumnKinds[header] ?? "string", columnTypeOverrides[header], factsGeneralSettings),
      ]),
    )),
    [columnTypeOverrides, displayedFactRows, factsGeneralSettings, resolvedColumnKinds, selectedFactColumns],
  );

  function pushNotice(type: NoticeType, text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setNotices((prev) => [...prev, { id, type, text }]);
    window.setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== id));
    }, 4200);
  }

  function showAnalysisTooltip(text: string, target: HTMLElement) {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    const bounds = target.getBoundingClientRect();
    setAnalysisTooltip({
      text: normalized,
      x: bounds.left + bounds.width / 2,
      y: bounds.top - 8,
    });
  }

  function hideAnalysisTooltip() {
    setAnalysisTooltip(null);
  }

  function getAnalysisTooltipProps(text: string) {
    return {
      onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => showAnalysisTooltip(text, event.currentTarget),
      onMouseLeave: hideAnalysisTooltip,
      onFocus: (event: ReactFocusEvent<HTMLElement>) => showAnalysisTooltip(text, event.currentTarget),
      onBlur: hideAnalysisTooltip,
    };
  }

  function updateSettingsSummary(nextSettings: Settings) {
    setSettingsSummary({
      has_db_path_1: Boolean(nextSettings.db_path_1.trim()),
      has_db_path_2: Boolean(nextSettings.db_path_2.trim()),
    });
  }

  function clearSettingsAccess() {
    setSettingsAccessToken("");
    setSettingsAuthorized(false);
    setSettings({ db_path_1: "", db_path_2: "" });
    window.localStorage.removeItem(SETTINGS_TOKEN_STORAGE_KEY);
  }

  function isUnauthorizedError(error: unknown): error is ApiError {
    return error instanceof ApiError && error.status === 401;
  }

  async function loadProtectedSettings(token: string) {
    const loaded = await getSettings(token);
    setSettings(loaded);
    updateSettingsSummary(loaded);
    setSettingsAuthorized(true);
    return loaded;
  }

  async function requestSettingsAccess(): Promise<string | null> {
    if (settingsAccessToken) {
      try {
        await loadProtectedSettings(settingsAccessToken);
        return settingsAccessToken;
      } catch (err) {
        if (!isUnauthorizedError(err)) {
          throw err;
        }
        clearSettingsAccess();
      }
    }

    const password = window.prompt("Введите пароль для доступа к вкладке Настройки", "");
    if (password === null) {
      return null;
    }

    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      pushNotice("info", "Пароль не введен.");
      return null;
    }

    const auth = await authenticateSettingsAccess(trimmedPassword);
    setSettingsAccessToken(auth.token);
    window.localStorage.setItem(SETTINGS_TOKEN_STORAGE_KEY, auth.token);
    await loadProtectedSettings(auth.token);
    return auth.token;
  }

  async function onOpenSettingsTab() {
    try {
      setBusy(true);
      const token = await requestSettingsAccess();
      if (!token) {
        setStatus("Открытие настроек отменено.");
        return;
      }

      setActiveTab("settings");
      setStatus("Доступ к настройкам открыт.");
    } catch (err) {
      setStatus(`Ошибка доступа к настройкам: ${String(err)}`);
      pushNotice("error", `Ошибка доступа к настройкам: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [summary, t] = await Promise.all([getSettingsSummary(), getTemplates()]);
        setSettingsSummary(summary);
        setTemplates(t);
        if (t.length > 0) {
          setTemplateKey(t[0].key);
        }
      } catch (err) {
        setStatus(`Ошибка инициализации: ${String(err)}`);
        pushNotice("error", `Ошибка инициализации: ${String(err)}`);
      }
    })();
  }, []);

  useEffect(() => {
    if (!templateKey && templates.length > 0) {
      setTemplateKey(templates[0].key);
    }
  }, [templateKey, templates]);

  useEffect(() => {
    if (!templateKey) {
      setSavedColumnConfig(null);
      setSavedColumnTypeConfig(null);
      setSavedFilterConfig(null);
      setFactsGeneralSettings(DEFAULT_FACTS_GENERAL_SETTINGS);
      setDraftFactsGeneralSettings(DEFAULT_FACTS_GENERAL_SETTINGS);
      setColumnTypeOverrides({});
      setColumnFilters({});
      setDraftColumnFilters({});
      return;
    }

    (async () => {
      try {
        const [config, typeConfig, filterConfig] = await Promise.all([
          getColumnConfig(templateKey),
          getColumnTypeConfig(templateKey),
          getFilterConfig(templateKey),
        ]);
        setSavedColumnConfig(config);
        setFactsGeneralSettings(fromColumnConfigGeneral(config.general));
        setDraftFactsGeneralSettings(fromColumnConfigGeneral(config.general));
        setSavedColumnTypeConfig(typeConfig);
        setSavedFilterConfig(filterConfig);
        setColumnTypeOverrides(typeConfig.overrides);
        const normalizedFilters = normalizeFilterConfig(filterConfig.filters);
        setColumnFilters(normalizedFilters);
        setDraftColumnFilters(normalizedFilters);
      } catch {
        setSavedColumnConfig({
          template_key: templateKey,
          columns: [],
          widths: {},
          general: toColumnConfigGeneral(DEFAULT_FACTS_GENERAL_SETTINGS),
        });
        setFactsGeneralSettings(DEFAULT_FACTS_GENERAL_SETTINGS);
        setDraftFactsGeneralSettings(DEFAULT_FACTS_GENERAL_SETTINGS);
        setSavedColumnTypeConfig({ template_key: templateKey, overrides: {} });
        setSavedFilterConfig({ template_key: templateKey, filters: {} });
        setColumnTypeOverrides({});
        setColumnFilters({});
        setDraftColumnFilters({});
      }
    })();
  }, [templateKey]);

  useEffect(() => {
    setVisibleFactColumns(loadHeaders);
    setDraftVisibleFactColumns(loadHeaders);
    setColumnFilters((current) => mergeFiltersWithHeaders(loadHeaders, current));
    setDraftColumnFilters((current) => mergeFiltersWithHeaders(loadHeaders, current));
    setColumnWidths((current) => Object.fromEntries(
      Object.entries(current).filter(([header]) => loadHeaders.includes(header)),
    ));
  }, [loadHeaders]);

  useEffect(() => {
    if (!templateKey || !loadHeaders.length || !savedFilterConfig || savedFilterConfig.template_key !== templateKey) {
      return;
    }

    const savedFilters = mergeFiltersWithHeaders(loadHeaders, normalizeFilterConfig(savedFilterConfig.filters));
    setColumnFilters(savedFilters);
    setDraftColumnFilters(savedFilters);
  }, [loadHeaders, savedFilterConfig, templateKey]);

  useEffect(() => {
    if (!templateKey || !loadHeaders.length || !savedColumnConfig || savedColumnConfig.template_key !== templateKey) {
      return;
    }

    const savedColumns = orderColumnsByHeaders(loadHeaders, savedColumnConfig.columns ?? []);
    if (savedColumns.length) {
      setVisibleFactColumns(savedColumns);
      setDraftVisibleFactColumns(savedColumns);
    }

    const restoredGeneralSettings = fromColumnConfigGeneral(savedColumnConfig.general);
    setFactsGeneralSettings(restoredGeneralSettings);
    setDraftFactsGeneralSettings(restoredGeneralSettings);
    setColumnWidths(() => {
      const next: Record<string, number> = {};
      const savedWidths = savedColumnConfig.widths ?? {};
      loadHeaders.forEach((header) => {
        if (savedWidths[header]) {
          next[header] = savedWidths[header];
        }
      });
      return {
        ...next,
        ...readStoredColumnWidths(templateKey, loadHeaders),
      };
    });
  }, [loadHeaders, savedColumnConfig, templateKey]);

  useEffect(() => {
    if (!templateKey || !loadHeaders.length || activeColumnResize) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const normalizedWidths = normalizeColumnWidths(columnWidths, loadHeaders);
      if (!Object.keys(normalizedWidths).length) {
        window.localStorage.removeItem(getColumnWidthsStorageKey(templateKey));
        return;
      }
      window.localStorage.setItem(getColumnWidthsStorageKey(templateKey), JSON.stringify(normalizedWidths));
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeColumnResize, columnWidths, loadHeaders, templateKey]);

  useEffect(() => {
    if (templateKey !== DOWNTIME_TEMPLATE_KEY || activeTab !== "facts") {
      return;
    }

    void onUpload();
  }, [activeTab, templateKey]);

  useEffect(() => {
    if (!factsPanelResizing) {
      return undefined;
    }

    const onMouseMove = (event: MouseEvent) => {
      const bounds = factsBodyRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const nextWidth = bounds.right - event.clientX;
      const clamped = Math.max(MIN_FACTS_PANEL_WIDTH, Math.min(MAX_FACTS_PANEL_WIDTH, nextWidth));
      setFactsPanelWidth(clamped);
    };

    const onMouseUp = () => {
      setFactsPanelResizing(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [factsPanelResizing]);

  useEffect(() => {
    if (!analysisPanelResizing) {
      return undefined;
    }

    const onMouseMove = (event: MouseEvent) => {
      const bounds = analysisBodyRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const nextWidth = event.clientX - bounds.left;
      const clamped = Math.max(MIN_ANALYSIS_PANEL_WIDTH, Math.min(MAX_ANALYSIS_PANEL_WIDTH, nextWidth));
      setAnalysisPanelWidth(clamped);
    };

    const onMouseUp = () => {
      setAnalysisPanelResizing(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [analysisPanelResizing]);

  useEffect(() => {
    if (!analysisCenterResizing) {
      return undefined;
    }

    const onMouseMove = (event: MouseEvent) => {
      const bounds = analysisWorkspaceRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const nextWidth = clampValue(
        event.clientX - bounds.left,
        MIN_ANALYSIS_CENTER_WIDTH,
        MAX_ANALYSIS_CENTER_WIDTH,
      );
      setAnalysisCenterWidth(nextWidth);
    };

    const onMouseUp = () => {
      setAnalysisCenterResizing(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [analysisCenterResizing]);

  useEffect(() => {
    window.localStorage.setItem(ANALYSIS_PANEL_VISIBLE_STORAGE_KEY, String(analysisPanelVisible));
  }, [analysisPanelVisible]);

  useEffect(() => {
    window.localStorage.setItem(ANALYSIS_PANEL_WIDTH_STORAGE_KEY, String(analysisPanelWidth));
  }, [analysisPanelWidth]);

  useEffect(() => {
    if (!activeColumnResize) {
      return undefined;
    }

    const onMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.max(factsGeneralSettings.minWidth, activeColumnResize.startWidth + (event.clientX - activeColumnResize.startX));
      setColumnWidths((current) => ({
        ...current,
        [activeColumnResize.column]: nextWidth,
      }));
    };

    const onMouseUp = () => {
      setActiveColumnResize(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [activeColumnResize, factsGeneralSettings.minWidth]);

  useEffect(() => {
    if (!columnMoveAnimation) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setColumnMoveAnimation((current) => (current?.key === columnMoveAnimation.key ? null : current));
    }, 260);

    return () => {
      window.clearTimeout(timer);
    };
  }, [columnMoveAnimation]);

  const analysisHeaders = useMemo(() => analysisLoadResult?.headers ?? [], [analysisLoadResult]);
  const analysisRows = useMemo(() => analysisLoadResult?.rows ?? [], [analysisLoadResult]);
  const appliedChartRows = useMemo(() => {
    if (!analysisChartApplied || !analysisRows.length) {
      return [];
    }

    if (analysisChartApplied.type === "pie") {
      const grouped = aggregateChartRows(
        analysisRows,
        analysisChartApplied.pieCategoryColumn,
        analysisChartApplied.pieAggregation,
        analysisChartApplied.pieValueColumn,
      );
      const limitedRows = grouped.slice(0, Math.max(1, analysisChartApplied.pieTopCount));
      const restValue = grouped.slice(limitedRows.length).reduce((sum, entry) => sum + entry.value, 0);
      return restValue > 0 ? [...limitedRows, { label: "Прочее", value: restValue }] : limitedRows;
    }

    return aggregateChartRows(
      analysisRows,
      analysisChartApplied.barCategoryColumn,
      analysisChartApplied.barAggregation,
      analysisChartApplied.barValueColumn,
    ).slice(0, 12);
  }, [analysisChartApplied, analysisRows]);

  useEffect(() => {
    if (!analysisHeaders.length) {
      setAnalysisChartDraft(DEFAULT_ANALYSIS_CHART_DRAFT);
      setAnalysisChartApplied(null);
      return;
    }

    const firstHeader = analysisHeaders[0] ?? "";
    const numericHeader = analysisHeaders.find((header) => {
      return analysisRows.some((row) => parseNumberValue(row[header]) !== null);
    }) ?? "";

    setAnalysisChartDraft((current) => ({
      ...current,
      pieCategoryColumn: current.pieCategoryColumn && analysisHeaders.includes(current.pieCategoryColumn)
        ? current.pieCategoryColumn
        : firstHeader,
      pieValueColumn: current.pieValueColumn && analysisHeaders.includes(current.pieValueColumn)
        ? current.pieValueColumn
        : numericHeader,
      barCategoryColumn: current.barCategoryColumn && analysisHeaders.includes(current.barCategoryColumn)
        ? current.barCategoryColumn
        : firstHeader,
      barValueColumn: current.barValueColumn && analysisHeaders.includes(current.barValueColumn)
        ? current.barValueColumn
        : numericHeader,
    }));
    setAnalysisChartApplied(null);
  }, [analysisHeaders, analysisRows]);

  async function onSaveFactsView() {
    // Сохранение теперь разрешено для всех шаблонов, включая "Простои"

    if (!displayedFactExportRows.length) {
      pushNotice("info", "Нет данных в области Данные для сохранения.");
      return;
    }

    const suggestedName = createTimestampedFileName("data");
    const inputName = window.prompt("Введите имя файла. Расширение .xlsx будет добавлено автоматически.", suggestedName);
    if (inputName === null) {
      return;
    }

    const trimmedName = inputName.trim();
    if (!trimmedName) {
      pushNotice("info", "Имя файла не введено.");
      return;
    }

    try {
      setBusy(true);
      const saved = await exportXlsxToSettings(displayedFactExportRows, trimmedName);
      setStatus(`Данные сохранены. Файл: ${saved.saved_path}`);
      pushNotice("success", `Данные сохранены. Файл: ${saved.filename}`);
    } catch (err) {
      setStatus(`Ошибка сохранения данных: ${String(err)}`);
      pushNotice("error", `Ошибка сохранения данных: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveSettings() {
    try {
      const token = settingsAccessToken || await requestSettingsAccess();
      if (!token) {
        setStatus("Сохранение настроек отменено.");
        return;
      }

      setBusy(true);
      const saved = await saveSettings(settings, token);
      setSettings(saved);
      updateSettingsSummary(saved);
      setStatus("Маршруты сохранены.");
      pushNotice("success", "Маршруты сохранены.");
    } catch (err) {
      if (isUnauthorizedError(err)) {
        clearSettingsAccess();
      }
      setStatus(`Ошибка сохранения: ${String(err)}`);
      pushNotice("error", `Ошибка сохранения: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onUpload() {
    let localTemplates = templates;
    if (localTemplates.length === 0) {
      try {
        const loaded = await getTemplates();
        setTemplates(loaded);
        localTemplates = loaded;
      } catch (err) {
        setStatus(`Не удалось получить шаблоны: ${String(err)}`);
        pushNotice("error", `Не удалось получить шаблоны: ${String(err)}`);
        return;
      }
    }

    const effectiveTemplateKey = templateKey || localTemplates[0]?.key || "";

    if (!effectiveTemplateKey) {
      setStatus("Шаблоны не найдены. Проверьте backend и перезагрузите страницу.");
      pushNotice("error", "Шаблоны не найдены. Проверьте backend и перезагрузите страницу.");
      return;
    }

    if (effectiveTemplateKey === DOWNTIME_TEMPLATE_KEY) {
      if (!hasRoute) {
        setStatus("Маршрут БД 1 не задан. Укажите путь во вкладке Настройки.");
        pushNotice("error", "Маршрут БД 1 не задан. Укажите путь во вкладке Настройки.");
        return;
      }

      try {
        setBusy(true);
        const res = await loadDowntimeFacts();
        setLoadResult(res);
        setLastParseSnapshot(null);
        setStatus(`Загрузка простоя завершена. Источник: ${res.source_file}. Строк: ${res.total_rows}.`);
        pushNotice("success", "Файл простоя загружен автоматически.");
      } catch (err) {
        setStatus(`Ошибка загрузки простоя: ${String(err)}`);
        pushNotice("error", `Ошибка загрузки простоя: ${String(err)}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!file) {
      setStatus("Выберите xlsx-файл.");
      pushNotice("info", "Выберите xlsx-файл.");
      return;
    }

    try {
      setBusy(true);
      if (!templateKey) {
        setTemplateKey(effectiveTemplateKey);
      }
      const res = await uploadFacts(effectiveTemplateKey, file);
      setLoadResult(res);
      setLastParseSnapshot(null);
      setStatus(
        `Загрузка завершена. Всего: ${res.total_rows}, валидных: ${res.valid_count}, ошибок: ${res.error_count}.`,
      );
      if (res.error_count > 0) {
        pushNotice("error", `Загрузка завершена с ошибками: ${res.error_count}. См. нижнюю таблицу.`);
      } else {
        pushNotice("success", "Загрузка завершена без ошибок.");
      }
    } catch (err) {
      setStatus(`Ошибка загрузки: ${String(err)}`);
      pushNotice("error", `Ошибка загрузки: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onSaveColumnSelection() {
    if (!templateKey || !loadHeaders.length) {
      pushNotice("info", "Сначала загрузите данные, чтобы сохранить конфигурацию столбцов.");
      return;
    }

    try {
      const normalizedWidths = normalizeColumnWidths(columnWidths, selectedFactColumns);
      const config = await saveColumnConfig(
        templateKey,
        selectedFactColumns,
        normalizedWidths,
        toColumnConfigGeneral(factsGeneralSettings),
      );
      setSavedColumnConfig(config);
      setStatus("Конфигурация столбцов сохранена.");
      pushNotice("success", "Конфигурация столбцов сохранена.");
    } catch (err) {
      setStatus(`Ошибка сохранения конфигурации: ${String(err)}`);
      pushNotice("error", `Ошибка сохранения конфигурации: ${String(err)}`);
    }
  }

  async function onSaveColumnTypeSelection() {
    if (!templateKey || !loadHeaders.length) {
      pushNotice("info", "Сначала загрузите данные, чтобы сохранить типы столбцов.");
      return;
    }

    const normalizedOverrides = Object.fromEntries(
      Object.entries(columnTypeOverrides).filter(([, value]) => value && value !== "auto"),
    );

    try {
      const config = await saveColumnTypeConfig(templateKey, normalizedOverrides);
      setSavedColumnTypeConfig(config);
      setColumnTypeOverrides(config.overrides);
      setStatus("Типы столбцов сохранены.");
      pushNotice("success", "Типы столбцов сохранены.");
    } catch (err) {
      setStatus(`Ошибка сохранения типов столбцов: ${String(err)}`);
      pushNotice("error", `Ошибка сохранения типов столбцов: ${String(err)}`);
    }
  }

  function onApplySavedColumnSelection() {
    if (!loadHeaders.length) {
      pushNotice("info", "Сначала загрузите данные, чтобы применить конфигурацию столбцов.");
      return;
    }

    const savedColumns = savedColumnConfig?.columns ?? [];
    const nextColumns = orderColumnsByHeaders(loadHeaders, savedColumns);
    if (!nextColumns.length) {
      pushNotice("info", "Для текущего файла нет сохраненной конфигурации или в ней нет подходящих столбцов.");
      return;
    }

    setVisibleFactColumns(nextColumns);
    setDraftVisibleFactColumns(nextColumns);
    const restoredGeneralSettings = fromColumnConfigGeneral(savedColumnConfig?.general);
    setFactsGeneralSettings(restoredGeneralSettings);
    setDraftFactsGeneralSettings(restoredGeneralSettings);
    setColumnWidths(() => {
      const next: Record<string, number> = {};
      const savedWidths = savedColumnConfig?.widths ?? {};
      loadHeaders.forEach((header) => {
        if (savedWidths[header]) {
          next[header] = savedWidths[header];
        }
      });
      return {
        ...next,
        ...readStoredColumnWidths(templateKey, loadHeaders),
      };
    });
    setStatus("Сохраненная конфигурация столбцов применена.");
    pushNotice("success", "Сохраненная конфигурация столбцов применена.");
  }

  function toggleFactColumn(column: string) {
    setDraftVisibleFactColumns((current) => (
      current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column]
    ));
  }

  async function moveFactColumn(column: string, direction: -1 | 1) {
    const currentColumns = [...selectedFactColumns];
    const index = currentColumns.indexOf(column);
    if (index === -1) {
      return;
    }

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= currentColumns.length) {
      return;
    }

    const nextColumns = [...currentColumns];
    [nextColumns[index], nextColumns[nextIndex]] = [nextColumns[nextIndex], nextColumns[index]];

    setVisibleFactColumns(nextColumns);
    setDraftVisibleFactColumns(nextColumns);
    setColumnMoveAnimation(null);
    window.requestAnimationFrame(() => {
      setColumnMoveAnimation({ column, direction, key: Date.now() });
    });
    setSavedColumnConfig((current) => (current && current.template_key === templateKey
      ? {
        ...current,
        columns: nextColumns,
      }
      : current));

    if (!templateKey || !loadHeaders.length) {
      return;
    }

    try {
      const normalizedWidths = normalizeColumnWidths(columnWidths, nextColumns);
      const config = await saveColumnConfig(
        templateKey,
        nextColumns,
        normalizedWidths,
        toColumnConfigGeneral(factsGeneralSettings),
      );
      setSavedColumnConfig(config);
      setStatus("Порядок столбцов сохранён.");
    } catch (err) {
      setStatus(`Ошибка автосохранения порядка столбцов: ${String(err)}`);
      pushNotice("error", `Ошибка автосохранения порядка столбцов: ${String(err)}`);
    }
  }

  function onApplyFactColumnSelection() {
    if (!loadHeaders.length) {
      pushNotice("info", "Сначала загрузите данные, чтобы применить конфигурацию столбцов.");
      return;
    }

    const nextColumns = orderColumnsByHeaders(loadHeaders, draftVisibleFactColumns);
    setVisibleFactColumns(nextColumns);
    setDraftVisibleFactColumns(nextColumns);
    setStatus("Выбор столбцов применен.");
    pushNotice("success", "Выбор столбцов применен.");
  }

  function onApplyGeneralSettings() {
    const nextSettings = sanitizeGeneralSettings(draftFactsGeneralSettings);
    setFactsGeneralSettings(nextSettings);
    setDraftFactsGeneralSettings(nextSettings);
    setStatus("Общие настройки применены.");
    pushNotice("success", "Общие настройки применены.");
  }

  function onResetIndividualWidths() {
    setColumnWidths({});
    setStatus("Индивидуальные ширины сброшены.");
    pushNotice("success", "Индивидуальные ширины сброшены.");
  }

  function updateColumnFilter(header: string, patch: Partial<ColumnFilterState>) {
    setDraftColumnFilters((current) => ({
      ...current,
      [header]: {
        ...(current[header] ?? defaultFilterState()),
        ...patch,
      },
    }));
  }

  function clearAllFilters() {
    const cleared = mergeFiltersWithHeaders(loadHeaders, {});
    setDraftColumnFilters(cleared);
    setStatus("Фильтры очищены.");
  }

  function onApplyFilterSelection() {
    const appliedFilters = mergeFiltersWithHeaders(loadHeaders, draftColumnFilters);
    setColumnFilters(appliedFilters);
    setDraftColumnFilters(appliedFilters);
    setStatus("Фильтры применены.");
    pushNotice("success", "Фильтры применены.");
  }

  async function onSaveFilterSelection() {
    if (!templateKey || !loadHeaders.length) {
      pushNotice("info", "Сначала загрузите данные, чтобы сохранить конфигурацию фильтров.");
      return;
    }

    try {
      const config = await saveFilterConfig(templateKey, normalizeFilterConfig(columnFilters));
      setSavedFilterConfig(config);
      setStatus("Конфигурация фильтров сохранена.");
      pushNotice("success", "Конфигурация фильтров сохранена.");
    } catch (err) {
      setStatus(`Ошибка сохранения фильтров: ${String(err)}`);
      pushNotice("error", `Ошибка сохранения фильтров: ${String(err)}`);
    }
  }

  function onApplySavedFilterSelection() {
    const savedFilters = mergeFiltersWithHeaders(loadHeaders, normalizeFilterConfig(savedFilterConfig?.filters));
    setColumnFilters(savedFilters);
    setDraftColumnFilters(savedFilters);
    setStatus("Сохраненная конфигурация фильтров применена.");
    pushNotice("success", "Сохраненная конфигурация фильтров применена.");
  }

  function onTopScrollbarScroll() {
    if (dataTableBottomScrollRef.current && dataTableTopScrollRef.current) {
      dataTableBottomScrollRef.current.scrollLeft = dataTableTopScrollRef.current.scrollLeft;
    }
  }

  function onBottomScrollbarScroll() {
    if (dataTableBottomScrollRef.current && dataTableTopScrollRef.current) {
      dataTableTopScrollRef.current.scrollLeft = dataTableBottomScrollRef.current.scrollLeft;
    }
  }

  async function onAnalysisSourceFileChange(fileToUpload: File | null) {
    setAnalysisSourceFile(fileToUpload);
    setAnalysisChartApplied(null);

    if (!fileToUpload) {
      setAnalysisLoadResult(null);
      setStatus("Файл анализа очищен.");
      return;
    }

    try {
      setBusy(true);
      const result = await uploadAnalysisSource(fileToUpload);
      setAnalysisLoadResult(result);
      setStatus(`Файл анализа загружен. Строк: ${result.total_rows}.`);
      pushNotice("success", `Файл анализа '${fileToUpload.name}' загружен.`);
    } catch (err) {
      setAnalysisLoadResult(null);
      setStatus(`Ошибка загрузки файла анализа: ${String(err)}`);
      pushNotice("error", `Ошибка загрузки файла анализа: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function onProcess() {
    if (!analysisRows.length) {
      setStatus("Сначала загрузите данные для анализа.");
      pushNotice("info", "Сначала загрузите данные для анализа.");
      return;
    }

    setStatus("Отдельная обработка для вкладки 'Анализ' пока не реализована.");
    pushNotice("info", "Отдельная обработка для вкладки 'Анализ' пока не реализована.");
  }

  function onBuildAnalysisChart() {
    if (!analysisRows.length) {
      setStatus("Нет данных для построения графика.");
      pushNotice("info", "Нет данных для построения графика.");
      return;
    }

    if (analysisChartDraft.type === "pie") {
      if (!analysisChartDraft.pieCategoryColumn) {
        setStatus("Выберите столбец категории для круговой диаграммы.");
        pushNotice("info", "Выберите столбец категории для круговой диаграммы.");
        return;
      }
      if (analysisChartDraft.pieAggregation === "sum" && !analysisChartDraft.pieValueColumn) {
        setStatus("Выберите числовой столбец для суммы на круговой диаграмме.");
        pushNotice("info", "Выберите числовой столбец для суммы на круговой диаграмме.");
        return;
      }
    }

    if (analysisChartDraft.type === "bar") {
      if (!analysisChartDraft.barCategoryColumn) {
        setStatus("Выберите столбец категории для столбиковой диаграммы.");
        pushNotice("info", "Выберите столбец категории для столбиковой диаграммы.");
        return;
      }
      if (analysisChartDraft.barAggregation === "sum" && !analysisChartDraft.barValueColumn) {
        setStatus("Выберите числовой столбец для суммы на столбиковой диаграмме.");
        pushNotice("info", "Выберите числовой столбец для суммы на столбиковой диаграмме.");
        return;
      }
    }

    setAnalysisChartApplied(cloneAnalysisChartDraft(analysisChartDraft));
    setStatus("График построен.");
    pushNotice("success", "График построен.");
  }

  function renderTable(rows: Record<string, unknown>[], columns?: string[]) {
    if (columns && columns.length === 0) {
      return <div className="empty">Нет выбранных столбцов</div>;
    }
    if (!rows.length) {
      return <div className="empty">Нет данных</div>;
    }

    const headers = columns ?? Object.keys(rows[0]);
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} title={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {headers.map((h) => (
                  <td key={h} title={String(r[h] ?? "")}>{String(r[h] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderFilterEditor(header: string) {
    const filter = draftColumnFilters[header] ?? defaultFilterState();
    const kind = resolvedColumnKinds[header] ?? "string";

    if (kind === "number" || kind === "money") {
      return (
        <div className="filter-card" key={header}>
          <div className="filter-title truncate-text" title={header}>{header}</div>
          <div className="filter-inline">
            <select value={filter.operator} onChange={(e) => updateColumnFilter(header, { operator: e.target.value as NumberFilterOperator })}>
              <option value="eq">Равно</option>
              <option value="gt">Больше</option>
              <option value="lt">Меньше</option>
            </select>
            <input
              value={filter.value}
              onChange={(e) => updateColumnFilter(header, { value: e.target.value })}
              placeholder="Введите число"
            />
          </div>
        </div>
      );
    }

    if (kind === "date" || kind === "datetime") {
      const inputType = kind === "datetime" ? "datetime-local" : "date";
      return (
        <div className="filter-card" key={header}>
          <div className="filter-title truncate-text" title={header}>{header}</div>
          <div className="filter-stack">
            <label>
              От
              <input
                type={inputType}
                value={filter.from}
                onChange={(e) => updateColumnFilter(header, { from: e.target.value })}
              />
            </label>
            <label>
              До
              <input
                type={inputType}
                value={filter.to}
                onChange={(e) => updateColumnFilter(header, { to: e.target.value })}
              />
            </label>
          </div>
        </div>
      );
    }

    return (
      <div className="filter-card" key={header}>
        <div className="filter-title truncate-text" title={header}>{header}</div>
        <input
          value={filter.text}
          onChange={(e) => updateColumnFilter(header, { text: e.target.value })}
          placeholder="Содержит"
        />
      </div>
    );
  }

  function renderFactsDataTable() {
    if (selectedFactColumns.length === 0) {
      return <div className="empty">Нет выбранных столбцов</div>;
    }

    if (!displayedFactRows.length) {
      return <div className="empty">Нет данных</div>;
    }

    return (
      <div className="data-grid-shell">
        <div className="table-scroll-top" ref={dataTableTopScrollRef} onScroll={onTopScrollbarScroll}>
            <div style={{ width: `${totalDataTableWidth || DEFAULT_COLUMN_WIDTH}px` }} />
        </div>
        <div className="table-wrap table-wrap-data" ref={dataTableBottomScrollRef} onScroll={onBottomScrollbarScroll}>
            <table className="data-table" style={{ width: `${totalDataTableWidth || DEFAULT_COLUMN_WIDTH}px` }}>
            <thead>
              <tr>
                {selectedFactColumns.map((header, idx) => {
                  const width = getEffectiveColumnWidth(header);
                  const moveClassName = columnMoveAnimation?.column === header
                    ? `column-moved column-moved-${columnMoveAnimation.direction > 0 ? "right" : "left"}`
                    : "";
                  return (
                    <th
                      key={header}
                      className={moveClassName || undefined}
                      style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                    >
                      <div className="table-header-cell">
                        <span className="table-header-title" title={header}>{header}</span>
                        <span className="column-move-actions">
                          <button
                            className="column-move-btn"
                            title="Влево"
                            disabled={idx === 0}
                            onClick={() => void moveFactColumn(header, -1)}
                            tabIndex={-1}
                          >←</button>
                          <button
                            className="column-move-btn"
                            title="Вправо"
                            disabled={idx === selectedFactColumns.length - 1}
                            onClick={() => void moveFactColumn(header, 1)}
                            tabIndex={-1}
                          >→</button>
                        </span>
                        <span
                          className="column-resize-handle"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setActiveColumnResize({
                              column: header,
                              startX: event.clientX,
                              startWidth: width,
                            });
                          }}
                        />
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayedFactRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {selectedFactColumns.map((header) => {
                    const width = getEffectiveColumnWidth(header);
                    const value = formatCellValue(row[header], resolvedColumnKinds[header] ?? "string", columnTypeOverrides[header], factsGeneralSettings);
                    const moveClassName = columnMoveAnimation?.column === header
                      ? `column-moved column-moved-${columnMoveAnimation.direction > 0 ? "right" : "left"}`
                      : "";
                    return (
                      <td
                        key={header}
                        className={moveClassName || undefined}
                        style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}
                      >
                        <div className="data-cell-value" title={value}>{value}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderAnalysisChart() {
    if (!analysisRows.length) {
      return <div className="empty">Загрузите файл, чтобы построить график</div>;
    }

    if (!analysisChartApplied) {
      return <div className="empty">Настройте параметры и нажмите 'Построить'</div>;
    }

    if (!appliedChartRows.length) {
      return <div className="empty">По выбранным параметрам нет данных для визуализации</div>;
    }

    if (analysisChartApplied.type === "pie") {
      const total = appliedChartRows.reduce((sum, item) => sum + item.value, 0);
      let startAngle = 0;

      return (
        <div className="analysis-chart-card">
          <div className="analysis-chart-title">{analysisChartApplied.pieTitle || "Круговая диаграмма"}</div>
          <div className="analysis-chart-layout">
            <svg viewBox="0 0 320 320" className="analysis-chart-svg" aria-label="Круговая диаграмма">
              {appliedChartRows.map((item, index) => {
                const sliceAngle = total === 0 ? 0 : (item.value / total) * 360;
                const endAngle = startAngle + sliceAngle;
                const path = describePieArc(160, 160, 110, startAngle, endAngle);
                const midAngle = startAngle + sliceAngle / 2;
                const labelPoint = polarToCartesian(160, 160, 74, midAngle);
                const percent = total === 0 ? 0 : Math.round((item.value / total) * 100);
                const slice = (
                  <g key={item.label}>
                    <path d={path} fill={ANALYSIS_CHART_COLORS[index % ANALYSIS_CHART_COLORS.length]} />
                    {analysisChartApplied.pieShowLabels && percent >= 4 && (
                      <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" className="analysis-chart-slice-label">
                        {percent}%
                      </text>
                    )}
                  </g>
                );
                startAngle = endAngle;
                return slice;
              })}
            </svg>
            <div className="analysis-chart-legend">
              {appliedChartRows.map((item, index) => {
                const percent = total === 0 ? 0 : Math.round((item.value / total) * 100);
                return (
                  <div key={item.label} className="analysis-chart-legend-item">
                    <span className="analysis-chart-legend-color" style={{ backgroundColor: ANALYSIS_CHART_COLORS[index % ANALYSIS_CHART_COLORS.length] }} />
                    <span className="analysis-chart-legend-text">{item.label}</span>
                    <span className="analysis-chart-legend-value">{item.value.toLocaleString("ru-RU")} ({percent}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    const maxValue = Math.max(...appliedChartRows.map((item) => item.value), 1);

    return (
      <div className="analysis-chart-card">
        <div className="analysis-chart-title">{analysisChartApplied.barTitle || "Столбиковая диаграмма"}</div>
        <div className="analysis-bar-chart">
          {appliedChartRows.map((item, index) => {
            const widthPercent = maxValue === 0 ? 0 : (item.value / maxValue) * 100;
            return (
              <div key={item.label} className="analysis-bar-row">
                <div className="analysis-bar-label" title={item.label}>{item.label}</div>
                <div className="analysis-bar-track">
                  <div
                    className="analysis-bar-fill"
                    style={{
                      width: `${clampValue(widthPercent, 0, 100)}%`,
                      backgroundColor: ANALYSIS_CHART_COLORS[index % ANALYSIS_CHART_COLORS.length],
                    }}
                  />
                </div>
                <div className="analysis-bar-value">{item.value.toLocaleString("ru-RU")}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {analysisTooltip && (
        <div
          className="analysis-floating-tooltip"
          style={{ left: `${analysisTooltip.x}px`, top: `${analysisTooltip.y}px` }}
          role="tooltip"
        >
          {analysisTooltip.text}
        </div>
      )}
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {notices.map((n) => (
          <div key={n.id} className={`toast ${n.type}`}>
            {n.text}
          </div>
        ))}
      </div>

      <header className="topbar">
        <div className="brand">Система управления фактами</div>
        <nav className="tabs">
          <button className={activeTab === "facts" ? "active" : ""} onClick={() => setActiveTab("facts")}>
            Загрузка фактов
          </button>
          <button className={activeTab === "analysis" ? "active" : ""} onClick={() => setActiveTab("analysis")}>
            Анализ
          </button>
          <button
            className={activeTab === "instructions" ? "active" : ""}
            onClick={() => setActiveTab("instructions")}
          >
            Инструкции
          </button>
          <button className={activeTab === "journal" ? "active" : ""} onClick={() => setActiveTab("journal")}>
            Журнал
          </button>
          <button className={activeTab === "settings" ? "active" : ""} onClick={() => void onOpenSettingsTab()} disabled={busy}>
            Настройки
          </button>
        </nav>
      </header>

      <main className={`workspace${activeTab === "analysis" ? " workspace-analysis" : ""}`}>
        {activeTab === "settings" && (
          <section className="panel stack">
            <div className="settings-header">
              <h2>Настройки</h2>
              {settingsAuthorized && (
                <button
                  onClick={() => {
                    clearSettingsAccess();
                    setActiveTab("facts");
                    setStatus("Доступ к настройкам закрыт.");
                  }}
                >
                  Закрыть доступ
                </button>
              )}
            </div>
            <label>
              Маршрут БД 1 (папка с файлами для анализа)
              <input
                value={settings.db_path_1}
                onChange={(e) => setSettings((s) => ({ ...s, db_path_1: e.target.value }))}
                placeholder="Например: D:/data/in"
              />
            </label>
            <label>
              Маршрут БД 2 (папка для сохранения)
              <input
                value={settings.db_path_2}
                onChange={(e) => setSettings((s) => ({ ...s, db_path_2: e.target.value }))}
                placeholder="Например: D:/data/out"
              />
            </label>
            <div>
              <button className="primary" onClick={onSaveSettings} disabled={busy}>
                Добавить маршрут БД
              </button>
            </div>
          </section>
        )}

        {activeTab === "facts" && (
          <section className="panel facts-layout">
            <div className="template-hint">
              Доступно {templateOptions.length} шаблона: {selectedTemplate?.display_name || "не выбран"}
            </div>

            <div className="toolbar">
              <label>
                Шаблон
                <select
                  value={templateKey}
                  onChange={(e) => {
                    setTemplateKey(e.target.value);
                    setLoadResult(null);
                    setLastParseSnapshot(null);
                    setFile(null);
                    setColumnFilters({});
                    setDraftColumnFilters({});
                    setColumnWidths({});
                  }}
                >
                  {!templateKey && templates.length > 0 && (
                    <option value="" disabled>
                      Выберите шаблон
                    </option>
                  )}
                  {templateOptions.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.display_name}
                    </option>
                  ))}
                </select>
              </label>
              {!isDowntimeTemplate && (
                <label>
                  Файл xlsx
                  <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              )}
              <div className="file-pill">
                {isDowntimeTemplate
                  ? `Источник: ${loadResult?.source_file || "поиск файла prostoy* в Маршрут БД 1"}`
                  : `Файл: ${file?.name || "не выбран"}`}
              </div>
              <button className="primary" onClick={onUpload} disabled={busy}>
                {isDowntimeTemplate ? "Загрузить из папки" : "Загрузить"}
              </button>
              <button onClick={() => void onSaveFactsView()} disabled={busy || !displayedFactExportRows.length}>
                Сохранить
              </button>
              <button onClick={() => setFactsPanelVisible((current) => !current)}>
                {factsPanelVisible ? "Скрыть панель" : "Показать панель"}
              </button>
              <button
                onClick={() => {
                  setLoadResult(null);
                  setLastParseSnapshot(null);
                  setVisibleFactColumns([]);
                  setDraftVisibleFactColumns([]);
                  setColumnFilters({});
                  setDraftColumnFilters({});
                  setColumnWidths({});
                  setStatus("Экран очищен.");
                }}
              >
                Чистить
              </button>
            </div>

            <div className="facts-body" ref={factsBodyRef}>
              <div className="facts-main">
                <div className="split-zone">
                  <div className="split-panel">
                    <h3>Данные</h3>
                    {renderFactsDataTable()}
                  </div>
                  <div className="split-panel">
                    <h3>Ошибки</h3>
                    {renderTable(loadResult?.errors ?? [])}
                  </div>
                </div>
              </div>

              {factsPanelVisible && (
                <>
                  <div
                    className={`facts-resizer ${factsPanelResizing ? "active" : ""}`}
                    onMouseDown={() => setFactsPanelResizing(true)}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Изменить ширину панели столбцов"
                  />
                  <aside className="facts-sidebar panel" style={{ width: `${factsPanelWidth}px` }}>
                    <div className="facts-sidebar-header">
                      <h3>Панель данных</h3>
                      <button onClick={() => setFactsPanelVisible(false)}>Скрыть</button>
                    </div>

                    <div className="sidebar-tabs" role="tablist" aria-label="Панель данных">
                      <button className={factsSidebarTab === "general" ? "active" : ""} onClick={() => setFactsSidebarTab("general")}>
                        Общие
                      </button>
                      <button className={factsSidebarTab === "columns" ? "active" : ""} onClick={() => setFactsSidebarTab("columns")}>
                        Столбцы
                      </button>
                      <button className={factsSidebarTab === "filters" ? "active" : ""} onClick={() => setFactsSidebarTab("filters")}>
                        Фильтры
                      </button>
                      <button className={factsSidebarTab === "types" ? "active" : ""} onClick={() => setFactsSidebarTab("types")}>
                        Типы
                      </button>
                      <button className={factsSidebarTab === "processing" ? "active" : ""} onClick={() => setFactsSidebarTab("processing")}> 
                        Обработка
                      </button>
                    </div>

                    {factsSidebarTab === "general" && (
                      <div className="sidebar-section-stack">
                        <div className="general-settings-card">
                          <label>
                            Ширина столбца
                            <input
                              type="number"
                              min={draftFactsGeneralSettings.minWidth}
                              value={draftFactsGeneralSettings.defaultWidth}
                              onChange={(e) => setDraftFactsGeneralSettings((current) => sanitizeGeneralSettings({
                                ...current,
                                defaultWidth: Number(e.target.value || current.defaultWidth),
                              }))}
                            />
                          </label>
                          <label>
                            Минимальная ширина столбца
                            <input
                              type="number"
                              min={MIN_COLUMN_WIDTH}
                              value={draftFactsGeneralSettings.minWidth}
                              onChange={(e) => setDraftFactsGeneralSettings((current) => sanitizeGeneralSettings({
                                ...current,
                                minWidth: Number(e.target.value || MIN_COLUMN_WIDTH),
                              }))}
                            />
                          </label>
                          <label>
                            Кол-во строк
                            <input
                              type="number"
                              min={0}
                              value={draftFactsGeneralSettings.rowLimit || ""}
                              placeholder="Все строки"
                              onChange={(e) => setDraftFactsGeneralSettings((current) => sanitizeGeneralSettings({
                                ...current,
                                rowLimit: Number(e.target.value || 0),
                              }))}
                            />
                          </label>
                          <label className="checkbox-row checkbox-row-inline">
                            <input
                              type="checkbox"
                              checked={draftFactsGeneralSettings.hideMoneyCents}
                              onChange={(e) => setDraftFactsGeneralSettings((current) => ({
                                ...current,
                                hideMoneyCents: e.target.checked,
                              }))}
                            />
                            <span className="truncate-text" title="Копейки скрыть">Копейки скрыть</span>
                          </label>
                        </div>
                        <div className="facts-sidebar-actions">
                          <button className="action-apply" onClick={onApplyGeneralSettings} disabled={!hasPendingGeneralSettingsChanges}>
                            Применить
                          </button>
                          <button className="action-save" onClick={showAllFactRows} disabled={factsGeneralSettings.rowLimit === 0 && draftFactsGeneralSettings.rowLimit === 0}>
                            Показать все строки
                          </button>
                          <button className="action-restore" onClick={onResetIndividualWidths} disabled={!Object.keys(columnWidths).length}>
                            Сбросить индивидуальные ширины
                          </button>
                        </div>
                      </div>
                    )}

                    {factsSidebarTab === "columns" && (
                      <>
                        <div className="column-picker">
                          <div className="column-picker-header">Выбрать столбцы</div>
                          <div className="column-picker-body">
                            {!loadHeaders.length && <div className="empty">Загрузите файл, чтобы выбрать столбцы</div>}
                            {loadHeaders.map((header) => (
                              <label key={header} className="checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={draftVisibleFactColumns.includes(header)}
                                  onChange={() => toggleFactColumn(header)}
                                />
                                <span className="truncate-text" title={header}>{header}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="facts-sidebar-actions">
                          <button className="action-apply" onClick={onApplyFactColumnSelection} disabled={!loadHeaders.length || !hasPendingColumnSelectionChanges}>
                            Применить
                          </button>
                          <button className="action-save" onClick={onSaveColumnSelection} disabled={!loadHeaders.length}>
                            Сохранить конфигурацию
                          </button>
                          <button className="action-restore" onClick={onApplySavedColumnSelection} disabled={!savedColumnConfig?.columns?.length}>
                            Применить сохраненную
                          </button>
                        </div>
                      </>
                    )}

                    {factsSidebarTab === "filters" && (
                      <div className="sidebar-section-stack">
                        <div className="facts-sidebar-actions row-actions">
                          <button onClick={clearAllFilters} disabled={!loadHeaders.length}>
                            Очистить фильтры
                          </button>
                        </div>
                        <div className="facts-sidebar-actions">
                          <button className="action-apply" onClick={onApplyFilterSelection} disabled={!loadHeaders.length || !hasPendingFilterChanges}>
                            Применить
                          </button>
                          <button className="action-save" onClick={onSaveFilterSelection} disabled={!loadHeaders.length}>
                            Сохранить конфигурацию
                          </button>
                          <button className="action-restore" onClick={onApplySavedFilterSelection} disabled={!savedFilterConfig || Object.keys(savedFilterConfig.filters).length === 0}>
                            Применить сохраненную
                          </button>
                        </div>
                        <div className="filter-list">
                          {!loadHeaders.length && <div className="empty">Загрузите файл, чтобы настроить фильтры</div>}
                          {loadHeaders.map((header) => renderFilterEditor(header))}
                        </div>
                      </div>
                    )}

                    {factsSidebarTab === "types" && (
                      <div className="sidebar-section-stack">
                        <div className="type-list">
                          {!loadHeaders.length && <div className="empty">Загрузите файл, чтобы настроить типы</div>}
                          {loadHeaders.map((header) => (
                            <div key={header} className="type-row">
                              <div className="type-row-content">
                                <div className="type-title truncate-text" title={header}>{header}</div>
                                <div className="type-meta">Определено: {resolvedColumnKinds[header] ?? "string"}</div>
                              </div>
                              <select
                                className="type-select"
                                value={columnTypeOverrides[header] || "auto"}
                                onChange={(e) => {
                                  const nextValue = e.target.value;
                                  setColumnTypeOverrides((current) => {
                                    const next = { ...current };
                                    if (nextValue === "auto") {
                                      delete next[header];
                                    } else {
                                      next[header] = nextValue;
                                    }
                                    return next;
                                  });
                                }}
                              >
                                <option value="auto">Авто</option>
                                <option value="string">Строка</option>
                                <option value="number">Число</option>
                                <option value="money">Денежный</option>
                                <option value="date">Дата</option>
                                <option value="datetime">Дата/время</option>
                              </select>
                            </div>
                          ))}
                        </div>
                        <div className="facts-sidebar-actions">
                          <button onClick={onSaveColumnTypeSelection} disabled={!loadHeaders.length}>
                            Сохранить типы
                          </button>
                          <button
                            className="action-restore"
                            onClick={() => {
                              setColumnTypeOverrides(savedColumnTypeConfig?.overrides ?? {});
                              setStatus("Сохраненные типы применены.");
                            }}
                            disabled={!savedColumnTypeConfig}
                          >
                            Применить сохраненные
                          </button>
                        </div>
                      </div>
                    )}

                    {factsSidebarTab === "processing" && (
                      <div className="sidebar-section-stack">
                        <div className="processing-settings-card">
                          <label className="checkbox-row">
                            <input
                              type="radio"
                              name="processing-option"
                              checked={processingSettings.selectedOption === "parseReason"}
                              onChange={() => setProcessingSettings((current) => ({ ...current, selectedOption: "parseReason" }))}
                            />
                            Парсинг Провалы
                          </label>
                          <label className="checkbox-row">
                            <input
                              type="radio"
                              name="processing-option"
                              checked={processingSettings.selectedOption === "option2"}
                              onChange={() => setProcessingSettings((current) => ({ ...current, selectedOption: "option2" }))}
                            />
                            Опция 2
                          </label>

                          {processingSettings.selectedOption === "parseReason" && (
                            <>
                              <label>
                                Столбец из данных
                                <select
                                  value={processingSettings.parseReasonColumn}
                                  onChange={e => setProcessingSettings(s => ({ ...s, parseReasonColumn: e.target.value }))}
                                  disabled={!loadHeaders.length}
                                >
                                  <option value="">Выберите столбец</option>
                                  {loadHeaders.map((header) => (
                                    <option key={header} value={header}>{header}</option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Разделитель
                                <input
                                  type="text"
                                  placeholder="Разделитель"
                                  value={processingSettings.param}
                                  onChange={e => setProcessingSettings(s => ({ ...s, param: e.target.value }))}
                                />
                              </label>
                              <div className="processing-preview">
                                {processingParsePreview.parsableRows > 0
                                  ? `Будет создано строк: ${processingParsePreview.createdRows}. Заменяемых строк: ${processingParsePreview.parsableRows}. Дополнительно появится: ${processingParsePreview.addedRows}.`
                                  : "Нет видимых строк, подходящих под выбранный разделитель."}
                              </div>
                              <button className="action-apply" onClick={runProcessingParse} disabled={!canRunProcessingParse}>
                                Парсинг
                              </button>
                              <button className="action-restore" onClick={undoLastProcessingParse} disabled={!lastParseSnapshot}>
                                Откатить парсинг
                              </button>
                            </>
                          )}

                          {processingSettings.selectedOption === "option2" && (
                            <label>
                              Режим
                              <select value={processingSettings.mode} onChange={e => setProcessingSettings(s => ({ ...s, mode: e.target.value }))}>
                                <option value="mode1">Режим 1</option>
                                <option value="mode2">Режим 2</option>
                              </select>
                            </label>
                          )}
                        </div>
                        <div className="facts-sidebar-actions">
                          <button className="action-save" onClick={saveProcessingSettings}>
                            Сохранить настройки
                          </button>
                          <button className="action-restore" onClick={restoreProcessingSettings}>
                            Восстановить сохранённые
                          </button>
                        </div>
                      </div>
                    )}
                  </aside>
                </>
              )}
            </div>
          </section>
        )}

        {activeTab === "analysis" && (
          <section className="analysis-layout" ref={analysisBodyRef}>
            {analysisPanelVisible && (
              <>
                <aside className="analysis-left panel" style={{ width: `${analysisPanelWidth}px` }}>
                  <div className="analysis-panel-header">
                    <h3>Анализ</h3>
                  </div>
                  <div className="analysis-source-hint">
                    {analysisSourceFile?.name || analysisLoadResult?.source_file || "Файл не выбран"}
                  </div>
                  <div className="analysis-options">
                    <label className="radio-card" title="Простой">
                      <input
                        type="radio"
                        checked={analysisMode === "prepare"}
                        onChange={() => setAnalysisMode("prepare")}
                      />
                      <span className="truncate-text">Простой</span>
                    </label>
                    <label className="radio-card" title="Клиент">
                      <input
                        type="radio"
                        checked={analysisMode === "satisfaction"}
                        onChange={() => setAnalysisMode("satisfaction")}
                      />
                      <span className="truncate-text">Клиент</span>
                    </label>
                  </div>
                </aside>
                <div
                  className={`analysis-resizer ${analysisPanelResizing ? "active" : ""}`}
                  onMouseDown={() => setAnalysisPanelResizing(true)}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Изменить ширину панели анализа"
                />
              </>
            )}

            <div className="analysis-content">
              <div className="analysis-topbar panel">
                <div className="analysis-topbar-heading">
                  <span className="analysis-topbar-title">Панель управления анализом</span>
                  {!analysisPanelVisible && (
                    <button onClick={() => setAnalysisPanelVisible(true)}>Показать левую панель</button>
                  )}
                  {analysisPanelVisible && (
                    <button onClick={() => setAnalysisPanelVisible(false)}>Скрыть</button>
                  )}
                </div>
                <div className="analysis-topbar-meta" title={`Файл: ${analysisLoadResult?.source_file || "не загружен"} | Строк: ${analysisLoadResult?.total_rows ?? 0}`}>
                  Файл: {analysisLoadResult?.source_file || "не загружен"} | Строк: {analysisLoadResult?.total_rows ?? 0}
                </div>
                <div className="analysis-topbar-actions">
                  <input
                    ref={analysisFileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm"
                    className="analysis-hidden-input"
                    onChange={(event) => void onAnalysisSourceFileChange(event.target.files?.[0] ?? null)}
                  />
                  <button className="primary" onClick={() => analysisFileInputRef.current?.click()} disabled={busy}>
                    Загрузить
                  </button>
                  <button onClick={onProcess} disabled={busy || !analysisRows.length}>
                    Обработать
                  </button>
                </div>
              </div>

              <div className="analysis-workspace" ref={analysisWorkspaceRef}>
                <div className="analysis-center panel" style={{ width: `${analysisCenterWidth}px` }}>
                <div className="analysis-controls-scroll">
                <div className="analysis-chart-controls">
                  <label className="analysis-control-row">
                    <span className="analysis-control-label">Тип</span>
                    <select
                      {...getAnalysisTooltipProps(`Тип: ${getAnalysisChartTypeLabel(analysisChartDraft.type)}`)}
                      value={analysisChartDraft.type}
                      onChange={(event) => setAnalysisChartDraft((current) => ({
                        ...current,
                        type: event.target.value as AnalysisChartType,
                      }))}
                    >
                      <option value="pie">Пирог</option>
                      <option value="bar">Столбиковая</option>
                    </select>
                  </label>

                  {analysisChartDraft.type === "pie" && (
                    <>
                      <label className="analysis-control-row">
                        <span className="analysis-control-label">Категория</span>
                        <select
                          {...getAnalysisTooltipProps(`Категория: ${getTooltipValue(analysisChartDraft.pieCategoryColumn)}`)}
                          value={analysisChartDraft.pieCategoryColumn}
                          onChange={(event) => setAnalysisChartDraft((current) => ({
                            ...current,
                            pieCategoryColumn: event.target.value,
                          }))}
                          disabled={!analysisHeaders.length}
                        >
                          <option value="">Выберите столбец</option>
                          {analysisHeaders.map((header) => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </label>
                      <label className="analysis-control-row">
                        <span className="analysis-control-label">Агрегация</span>
                        <select
                          {...getAnalysisTooltipProps(`Агрегация: ${getAnalysisAggregationLabel(analysisChartDraft.pieAggregation)}`)}
                          value={analysisChartDraft.pieAggregation}
                          onChange={(event) => setAnalysisChartDraft((current) => ({
                            ...current,
                            pieAggregation: event.target.value as AnalysisAggregation,
                          }))}
                        >
                          <option value="count">Количество строк</option>
                          <option value="sum">Сумма по столбцу</option>
                        </select>
                      </label>
                      {analysisChartDraft.pieAggregation === "sum" && (
                        <label className="analysis-control-row">
                          <span className="analysis-control-label">Значение</span>
                          <select
                            {...getAnalysisTooltipProps(`Значение: ${getTooltipValue(analysisChartDraft.pieValueColumn)}`)}
                            value={analysisChartDraft.pieValueColumn}
                            onChange={(event) => setAnalysisChartDraft((current) => ({
                              ...current,
                              pieValueColumn: event.target.value,
                            }))}
                            disabled={!analysisHeaders.length}
                          >
                            <option value="">Выберите столбец</option>
                            {analysisHeaders.map((header) => (
                              <option key={header} value={header}>{header}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="analysis-control-row">
                        <span className="analysis-control-label">Заголовок</span>
                        <input
                          {...getAnalysisTooltipProps(`Заголовок: ${getTooltipValue(analysisChartDraft.pieTitle, "не заполнено")}`)}
                          value={analysisChartDraft.pieTitle}
                          onChange={(event) => setAnalysisChartDraft((current) => ({
                            ...current,
                            pieTitle: event.target.value,
                          }))}
                          placeholder="Название диаграммы"
                        />
                      </label>
                      <label className="analysis-control-row">
                        <span className="analysis-control-label">Топ категорий</span>
                        <input
                          {...getAnalysisTooltipProps(`Топ категорий: ${analysisChartDraft.pieTopCount}`)}
                          type="number"
                          min={1}
                          max={20}
                          value={analysisChartDraft.pieTopCount}
                          onChange={(event) => setAnalysisChartDraft((current) => ({
                            ...current,
                            pieTopCount: Math.max(1, Number(event.target.value || 1)),
                          }))}
                        />
                      </label>
                      <label className="checkbox-row checkbox-row-inline">
                        <input
                          {...getAnalysisTooltipProps(`Подписи: ${analysisChartDraft.pieShowLabels ? "включены" : "выключены"}`)}
                          type="checkbox"
                          checked={analysisChartDraft.pieShowLabels}
                          onChange={(event) => setAnalysisChartDraft((current) => ({
                            ...current,
                            pieShowLabels: event.target.checked,
                          }))}
                        />
                        <span className="truncate-text" {...getAnalysisTooltipProps("Подписи")}>Подписи</span>
                      </label>
                    </>
                  )}

                  {analysisChartDraft.type === "bar" && (
                    <>
                      <label className="analysis-control-row">
                        <span className="analysis-control-label">Категория</span>
                        <select
                          {...getAnalysisTooltipProps(`Категория: ${getTooltipValue(analysisChartDraft.barCategoryColumn)}`)}
                          value={analysisChartDraft.barCategoryColumn}
                          onChange={(event) => setAnalysisChartDraft((current) => ({
                            ...current,
                            barCategoryColumn: event.target.value,
                          }))}
                          disabled={!analysisHeaders.length}
                        >
                          <option value="">Выберите столбец</option>
                          {analysisHeaders.map((header) => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </label>
                      <label className="analysis-control-row">
                        <span className="analysis-control-label">Агрегация</span>
                        <select
                          {...getAnalysisTooltipProps(`Агрегация: ${getAnalysisAggregationLabel(analysisChartDraft.barAggregation)}`)}
                          value={analysisChartDraft.barAggregation}
                          onChange={(event) => setAnalysisChartDraft((current) => ({
                            ...current,
                            barAggregation: event.target.value as AnalysisAggregation,
                          }))}
                        >
                          <option value="count">Количество строк</option>
                          <option value="sum">Сумма по столбцу</option>
                        </select>
                      </label>
                      {analysisChartDraft.barAggregation === "sum" && (
                        <label className="analysis-control-row">
                          <span className="analysis-control-label">Значение</span>
                          <select
                            {...getAnalysisTooltipProps(`Значение: ${getTooltipValue(analysisChartDraft.barValueColumn)}`)}
                            value={analysisChartDraft.barValueColumn}
                            onChange={(event) => setAnalysisChartDraft((current) => ({
                              ...current,
                              barValueColumn: event.target.value,
                            }))}
                            disabled={!analysisHeaders.length}
                          >
                            <option value="">Выберите столбец</option>
                            {analysisHeaders.map((header) => (
                              <option key={header} value={header}>{header}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="analysis-control-row">
                        <span className="analysis-control-label">Заголовок</span>
                        <input
                          {...getAnalysisTooltipProps(`Заголовок: ${getTooltipValue(analysisChartDraft.barTitle, "не заполнено")}`)}
                          value={analysisChartDraft.barTitle}
                          onChange={(event) => setAnalysisChartDraft((current) => ({
                            ...current,
                            barTitle: event.target.value,
                          }))}
                          placeholder="Название диаграммы"
                        />
                      </label>
                    </>
                  )}

                  <button
                    className="primary analysis-build-button"
                    onClick={onBuildAnalysisChart}
                    disabled={!analysisRows.length}
                    {...getAnalysisTooltipProps("Построить")}
                  >
                    Построить
                  </button>
                </div>
                </div>

                <div className="analysis-chart-preview">
                  {renderAnalysisChart()}
                </div>
                </div>

                <div
                  className={`analysis-workspace-resizer ${analysisCenterResizing ? "active" : ""}`}
                  onMouseDown={() => setAnalysisCenterResizing(true)}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Изменить ширину центральной панели анализа"
                />

                <div className="analysis-table-side panel">
                  <div className="analysis-table-header">
                    <h3>Данные файла</h3>
                    <div className="summary">Столбцов: {analysisHeaders.length}</div>
                  </div>
                  {renderTable(analysisRows, analysisHeaders)}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "instructions" && (
          <section className="panel instructions">
            <h2>Инструкции</h2>
            <ol>
              <li>Во вкладке Настройки введите пароль и сохраните два маршрута.</li>
              <li>Во вкладке Загрузка фактов выберите шаблон и загрузите xlsx.</li>
              <li>Ошибки загрузки отобразятся в нижней таблице, загрузка не остановится.</li>
              <li>Во вкладке Анализ нажмите Обработать для получения итоговой таблицы и сводки.</li>
              <li>Экспортирует только текущие строки на экране.</li>
            </ol>

            <h3>Шаблон файла загрузки</h3>
            <p>
              Загружается файл формата xlsx. Данные читаются с первого листа, заголовки колонок должны
              находиться в первой строке. Названия колонок должны совпадать точно.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Колонка</th>
                    <th>Тип</th>
                    <th>Обязательность</th>
                    <th>Описание</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>deal_id</td>
                    <td>int</td>
                    <td>Да</td>
                    <td>Идентификатор сделки</td>
                  </tr>
                  <tr>
                    <td>date_create</td>
                    <td>date</td>
                    <td>Да</td>
                    <td>Дата создания сделки</td>
                  </tr>
                  <tr>
                    <td>closedate</td>
                    <td>date</td>
                    <td>Да</td>
                    <td>Дата закрытия сделки</td>
                  </tr>
                  <tr>
                    <td>причина_провала_(СВ)</td>
                    <td>str</td>
                    <td>Нет</td>
                    <td>Причина провала, используется в режиме подготовки данных</td>
                  </tr>
                  <tr>
                    <td>причина_провала</td>
                    <td>str</td>
                    <td>Нет</td>
                    <td>Категория причины провала</td>
                  </tr>
                  <tr>
                    <td>Удовлетворенность_клиента_(текст)</td>
                    <td>str</td>
                    <td>Нет</td>
                    <td>Текстовый комментарий по удовлетворенности</td>
                  </tr>
                  <tr>
                    <td>Удовлетворенность клиента</td>
                    <td>str</td>
                    <td>Нет</td>
                    <td>Список значений для режима удовлетворенности</td>
                  </tr>
                  <tr>
                    <td>оценка_клиента_от_1_до-5</td>
                    <td>str</td>
                    <td>Нет</td>
                    <td>Оценка клиента</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Поддерживаемые форматы дат: <b>ДД.ММ.ГГГГ</b>, <b>YYYY-MM-DD</b>, <b>YYYY-MM-DDTHH:MM:SS</b>.
              Если обязательная колонка отсутствует, пуста или имеет неверный тип, строка попадет в журнал ошибок.
            </p>

            <h3>Предложения: 02042026</h3>
            <ol>
              <li>При запуске приложения по умолчанию открывать вкладку Загрузка фактов.</li>
              <li>Для вкладки Настройки добавить защиту через авторизацию и аутентификацию, так как сейчас доступ фактически открыт всем.</li>
              <li>Во вкладке Анализ левую панель сделать управляемой: добавить возможность менять ширину и скрывать ее.</li>
              <li>Радиокнопка режима анализа переименована в 'Простой'; при дальнейших изменениях важно сохранить понятную связь с шаблоном Простои.</li>
              <li>Текущая ошибка Для шаблона Простои вкладка Анализ недоступна приходит из backend, где анализ для этого шаблона сейчас явно запрещен.</li>
              <li>Безопасный вариант: заранее блокировать Анализ или кнопку Обработать для шаблона Простои и показывать понятное сообщение в интерфейсе, а не backend-ошибку.</li>
              <li>Если анализ для шаблона Простои все-таки нужен, требуется отдельно описать ожидаемую бизнес-логику обработки и результат на примерах.</li>
              <li>Практичный порядок доработок: стартовая вкладка Загрузка фактов, защита Настроек, resize и скрытие левой панели Анализа, затем решение по логике анализа Простои.</li>
            </ol>
          </section>
        )}

        {activeTab === "journal" && (
          <section className="panel journal-panel">
            <h2>Журнал</h2>
            <div className="journal-list">
              {journalEntries.map((entry) => (
                <article key={entry.id} className="journal-entry">
                  <h3>{entry.title}</h3>
                  <pre className="journal-entry-text">{entry.text}</pre>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="statusbar">{status || "Готово к работе."}</footer>
    </div>
  );
}

export default App;
