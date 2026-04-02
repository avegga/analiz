import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  getColumnTypeConfig,
  exportRows,
  exportXlsxToSettings,
  getColumnConfig,
  getFilterConfig,
  getSettings,
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
  type TemplateInfo,
} from "./api";

type TabKey = "facts" | "analysis" | "instructions" | "settings";
type FactsSidebarTabKey = "general" | "columns" | "filters" | "types";
type NoticeType = "success" | "error" | "info";
type Notice = { id: number; type: NoticeType; text: string };
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
const DEFAULT_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 60;
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
  const dataTableBottomScrollRef = useRef<HTMLDivElement | null>(null);
  const dataTableTopScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("analysis");
  const [settings, setSettings] = useState<Settings>({ db_path_1: "", db_path_2: "" });
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [loadResult, setLoadResult] = useState<LoadResponse | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("prepare");

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [factsSidebarTab, setFactsSidebarTab] = useState<FactsSidebarTabKey>("columns");
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
  const [activeColumnResize, setActiveColumnResize] = useState<{ column: string; startX: number; startWidth: number } | null>(null);

  const hasRoute = Boolean(settings.db_path_1?.trim());
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

  function pushNotice(type: NoticeType, text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setNotices((prev) => [...prev, { id, type, text }]);
    window.setTimeout(() => {
      setNotices((prev) => prev.filter((n) => n.id !== id));
    }, 4200);
  }

  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([getSettings(), getTemplates()]);
        setSettings(s);
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

  async function onSaveSettings() {
    try {
      setBusy(true);
      const saved = await saveSettings(settings);
      setSettings(saved);
      setStatus("Маршруты сохранены.");
      pushNotice("success", "Маршруты сохранены.");
    } catch (err) {
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
          <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>
            Настройки
          </button>
        </nav>
      </header>

      <main className="workspace">
        {activeTab === "settings" && (
          <section className="panel stack">
            <h2>Настройки</h2>
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
              <button onClick={() => setFactsPanelVisible((current) => !current)}>
                {factsPanelVisible ? "Скрыть панель" : "Показать панель"}
              </button>
              <button
                onClick={() => {
                  setLoadResult(null);
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
                  </aside>
                </>
              )}
            </div>
          </section>
        )}

        {activeTab === "analysis" && (
          <section className="analysis-layout">
            <aside className="analysis-left panel">
              <h3>Анализ</h3>
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
            </aside>

            <div className="analysis-right panel">
              {!hasRoute && <div className="warning">Маршрут к БД не выбран. Выберите маршрут на вкладке Настройки.</div>}

              <div className="toolbar">
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
              <li>Во вкладке Настройки заполните и сохраните два маршрута.</li>
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
      </main>

      <footer className="statusbar">{status || "Готово к работе."}</footer>
    </div>
  );
}

export default App;
