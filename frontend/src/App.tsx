import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  ApiError,
  authenticateSettingsAccess,
  getColumnTypeConfig,
  exportRows,
  exportXlsxToSettings,
  getColumnConfig,
  getFilterConfig,
  getSettings,
  getSettingsSummary,
  getTemplates,
  loadDowntimeFacts,
  runAnalysis,
  saveColumnConfig,
  saveFilterConfig,
  saveColumnTypeConfig,
  saveSettings,
  uploadFacts,
  type AnalysisResponse,
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

const DOWNTIME_TEMPLATE_KEY = "downtime";
const DEFAULT_FACTS_PANEL_WIDTH = 320;
const MIN_FACTS_PANEL_WIDTH = 240;
const MAX_FACTS_PANEL_WIDTH = 520;
const DEFAULT_ANALYSIS_PANEL_WIDTH = 220;
const MIN_ANALYSIS_PANEL_WIDTH = 160;
const MAX_ANALYSIS_PANEL_WIDTH = 360;
const DEFAULT_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 60;
const SETTINGS_TOKEN_STORAGE_KEY = "analiz.settingsAccessToken";
const ANALYSIS_PANEL_VISIBLE_STORAGE_KEY = "analiz.analysisPanelVisible";
const ANALYSIS_PANEL_WIDTH_STORAGE_KEY = "analiz.analysisPanelWidth";
const JOURNAL_STORAGE_KEY = "analiz.journalEntries";
const SEED_JOURNAL_ENTRIES: JournalEntry[] = [
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
  rowLimit: 0,
  hideMoneyCents: false,
};

function orderColumnsByHeaders(headers: string[], columns: string[]): string[] {
  return headers.filter((header) => columns.includes(header));
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

function formatCellValue(value: unknown, kind: ColumnKind, generalSettings: FactsGeneralSettings): string {
  if (kind === "money") {
    return formatMoneyValue(value, generalSettings.hideMoneyCents);
  }
  return String(value ?? "");
}

function hiddenColumnsByMode(mode: AnalysisMode): Set<string> {
  if (mode === "satisfaction") {
    return new Set([
      "оценка_клиента_от_1_до-5",
      "причина_провала",
      "причина_провала_(СВ)",
    ]);
  }
  return new Set([
    "Удовлетворенность клиента",
    "Удовлетворенность_клиента_(текст)",
    "оценка_клиента_от_1_до-5",
  ]);
}

function sanitizeAnalysisRows(rows: Record<string, unknown>[], mode: AnalysisMode): Record<string, unknown>[] {
  const hidden = hiddenColumnsByMode(mode);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    Object.entries(row).forEach(([k, v]) => {
      if (!hidden.has(k)) {
        out[k] = v;
      }
    });
    return out;
  });
}

function App() {
  const factsBodyRef = useRef<HTMLDivElement | null>(null);
  const analysisBodyRef = useRef<HTMLDivElement | null>(null);
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
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("prepare");

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
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
  const [activeColumnResize, setActiveColumnResize] = useState<{ column: string; startX: number; startWidth: number } | null>(null);

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
    return loadHeaders.filter((header) => visibleFactColumns.includes(header));
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
        formatCellValue(row[header], resolvedColumnKinds[header] ?? "string", factsGeneralSettings),
      ]),
    )),
    [displayedFactRows, factsGeneralSettings, resolvedColumnKinds, selectedFactColumns],
  );

  function pushNotice(type: NoticeType, text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setNotices((prev) => [...prev, { id, type, text }]);
    window.setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== id));
    }, 4200);
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

  const visibleRows = useMemo(
    () => sanitizeAnalysisRows(analysisResult?.rows ?? [], analysisMode),
    [analysisMode, analysisResult],
  );

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
        setAnalysisResult(null);
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
      setAnalysisResult(null);
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
      return next;
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

  async function onProcess() {
    if (!hasRoute) {
      setStatus("Маршрут к БД не выбран. Укажите путь во вкладке Настройки.");
      pushNotice("error", "Маршрут к БД не выбран. Укажите путь во вкладке Настройки.");
      return;
    }

    try {
      setBusy(true);
      const res = await runAnalysis(analysisMode);
      setAnalysisResult(res);
      setStatus(`Обработка завершена. Статус: ${res.status}.`);
      pushNotice("success", `Обработка завершена. Статус: ${res.status}.`);
    } catch (err) {
      setStatus(`Ошибка обработки: ${String(err)}`);
      pushNotice("error", `Ошибка обработки: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onExport(format: "xlsx" | "csv") {
    try {
      if (format === "xlsx") {
        const saved = await exportXlsxToSettings(visibleRows);
        setStatus(`Экспорт XLSX выполнен. Файл сохранен: ${saved.saved_path}`);
        pushNotice("success", `Экспорт XLSX выполнен. Файл: ${saved.filename}`);
      } else {
        await exportRows(visibleRows, format);
        setStatus(`Экспорт ${format.toUpperCase()} выполнен.`);
        pushNotice("success", `Экспорт ${format.toUpperCase()} выполнен.`);
      }
    } catch (err) {
      setStatus(`Ошибка экспорта: ${String(err)}`);
      pushNotice("error", `Ошибка экспорта: ${String(err)}`);
    }
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
                {selectedFactColumns.map((header) => {
                  const width = getEffectiveColumnWidth(header);
                  return (
                    <th key={header} style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}>
                      <div className="table-header-cell">
                        <span className="table-header-title" title={header}>{header}</span>
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
                    const value = formatCellValue(row[header], resolvedColumnKinds[header] ?? "string", factsGeneralSettings);
                    return (
                      <td key={header} style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }}>
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

  return (
    <div className="app-shell">
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

      <main className="workspace">
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
                    <button onClick={() => setAnalysisPanelVisible(false)}>Скрыть</button>
                  </div>
                  <div className="analysis-options">
                    <label className="radio-card">
                      <input
                        type="radio"
                        checked={analysisMode === "prepare"}
                        onChange={() => setAnalysisMode("prepare")}
                      />
                      Подготовка данных
                    </label>
                    <label className="radio-card">
                      <input
                        type="radio"
                        checked={analysisMode === "satisfaction"}
                        onChange={() => setAnalysisMode("satisfaction")}
                      />
                      Удовлетворение
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

            <div className="analysis-right panel">
              {!hasRoute && <div className="warning">Маршрут к БД не выбран. Выберите маршрут на вкладке Настройки.</div>}

              <div className="toolbar">
                <button onClick={() => setAnalysisPanelVisible((current) => !current)}>
                  {analysisPanelVisible ? "Скрыть левую панель" : "Показать левую панель"}
                </button>
                <button className="primary" onClick={onProcess} disabled={busy || !hasRoute}>
                  Обработать
                </button>
                <button onClick={() => onExport("xlsx")} disabled={!visibleRows.length}>
                  Экспорт xlsx
                </button>
                <button onClick={() => onExport("csv")} disabled={!visibleRows.length}>
                  Экспорт csv
                </button>
              </div>

              <div className="summary">
                Всего: {analysisResult?.total ?? 0} | Валидных: {analysisResult?.valid ?? 0} | Ошибок: {analysisResult?.errors ?? 0} |
                Статус: {analysisResult?.status ?? "Нет данных"}
              </div>

              {renderTable(visibleRows)}
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
              <li>Радиокнопку Подготовка данных можно переименовать, но сначала нужно уточнить, не создаст ли это путаницу с шаблоном Простои.</li>
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
