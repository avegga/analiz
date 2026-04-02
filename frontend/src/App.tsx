import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  exportRows,
  exportXlsxToSettings,
  getSettings,
  getTemplates,
  runAnalysis,
  saveSettings,
  uploadFacts,
  type AnalysisResponse,
  type LoadResponse,
  type Settings,
  type TemplateInfo,
} from "./api";

type TabKey = "facts" | "analysis" | "instructions" | "settings";
type NoticeType = "success" | "error" | "info";
type Notice = { id: number; type: NoticeType; text: string };
type AnalysisMode = "prepare" | "satisfaction";

const DOWNTIME_TEMPLATE_KEY = "downtime_placeholder";
const DOWNTIME_TEMPLATE: TemplateInfo = {
  key: DOWNTIME_TEMPLATE_KEY,
  display_name: "Простои",
  columns: [],
};

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

  const hasRoute = Boolean(settings.db_path_1?.trim());
  const templateOptions = useMemo(() => [...templates, DOWNTIME_TEMPLATE], [templates]);

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

    if (!file) {
      setStatus("Выберите xlsx-файл.");
      pushNotice("info", "Выберите xlsx-файл.");
      return;
    }
    if (!effectiveTemplateKey) {
      setStatus("Шаблоны не найдены. Проверьте backend и перезагрузите страницу.");
      pushNotice("error", "Шаблоны не найдены. Проверьте backend и перезагрузите страницу.");
      return;
    }
    if (effectiveTemplateKey === DOWNTIME_TEMPLATE_KEY) {
      setStatus("Шаблон «Простои» уже добавлен в список, но его описание еще не настроено.");
      pushNotice("info", "Шаблон «Простои» пока недоступен для загрузки.");
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

  const selectedTemplate = templateOptions.find((t) => t.key === templateKey);

  function renderTable(rows: Record<string, unknown>[]) {
    if (!rows.length) {
      return <div className="empty">Нет данных</div>;
    }

    const headers = Object.keys(rows[0]);
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {headers.map((h) => (
                  <td key={h}>{String(r[h] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
                <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
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
              <label>
                Файл xlsx
                <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <div className="file-pill">Файл: {file?.name || "не выбран"}</div>
              <button className="primary" onClick={onUpload} disabled={busy}>
                Загрузить
              </button>
              <button disabled>Сохранить</button>
              <button
                onClick={() => {
                  setLoadResult(null);
                  setStatus("Экран очищен.");
                }}
              >
                Чистить
              </button>
            </div>

            <div className="split-zone">
              <div className="split-panel">
                <h3>Данные</h3>
                {renderTable(loadResult?.rows ?? [])}
              </div>
              <div className="split-panel">
                <h3>Ошибки</h3>
                {renderTable(loadResult?.errors ?? [])}
              </div>
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
          </section>
        )}
      </main>

      <footer className="statusbar">{status || "Готово к работе."}</footer>
    </div>
  );
}

export default App;
