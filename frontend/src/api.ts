const API_BASE = "http://127.0.0.1:8001/api";

export type Settings = {
  db_path_1: string;
  db_path_2: string;
};

export type ColumnConfig = {
  template_key: string;
  columns: string[];
  widths: Record<string, number>;
  general: {
    default_width: number;
    min_width: number;
    row_limit: number;
    hide_money_cents: boolean;
  };
};

export type ColumnTypeConfig = {
  template_key: string;
  overrides: Record<string, string>;
};

export type FilterConfig = {
  template_key: string;
  filters: Record<string, {
    text: string;
    operator: string;
    value: string;
    from: string;
    to: string;
  }>;
};

export type TemplateInfo = {
  key: string;
  display_name: string;
  columns: Array<{ name: string; expected_type: string; required: boolean }>;
};

export type LoadResponse = {
  total_rows: number;
  valid_count: number;
  error_count: number;
  status: string;
  rows: Record<string, unknown>[];
  errors: Record<string, unknown>[];
  headers: string[];
  source_file: string;
};

export type AnalysisResponse = {
  rows: Record<string, unknown>[];
  total: number;
  valid: number;
  errors: number;
  status: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getSettings(): Promise<Settings> {
  return parseJson<Settings>(await fetch(`${API_BASE}/settings`));
}

export async function saveSettings(payload: Settings): Promise<Settings> {
  return parseJson<Settings>(
    await fetch(`${API_BASE}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function getTemplates(): Promise<TemplateInfo[]> {
  return parseJson<TemplateInfo[]>(await fetch(`${API_BASE}/templates`));
}

export async function getColumnConfig(templateKey: string): Promise<ColumnConfig> {
  return parseJson<ColumnConfig>(await fetch(`${API_BASE}/column-configs/${encodeURIComponent(templateKey)}`));
}

export async function saveColumnConfig(
  templateKey: string,
  columns: string[],
  widths: Record<string, number>,
  general: ColumnConfig["general"],
): Promise<ColumnConfig> {
  return parseJson<ColumnConfig>(
    await fetch(`${API_BASE}/column-configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_key: templateKey, columns, widths, general }),
    }),
  );
}

export async function getColumnTypeConfig(templateKey: string): Promise<ColumnTypeConfig> {
  return parseJson<ColumnTypeConfig>(await fetch(`${API_BASE}/column-type-configs/${encodeURIComponent(templateKey)}`));
}

export async function saveColumnTypeConfig(templateKey: string, overrides: Record<string, string>): Promise<ColumnTypeConfig> {
  return parseJson<ColumnTypeConfig>(
    await fetch(`${API_BASE}/column-type-configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_key: templateKey, overrides }),
    }),
  );
}

export async function getFilterConfig(templateKey: string): Promise<FilterConfig> {
  return parseJson<FilterConfig>(await fetch(`${API_BASE}/filter-configs/${encodeURIComponent(templateKey)}`));
}

export async function saveFilterConfig(
  templateKey: string,
  filters: FilterConfig["filters"],
): Promise<FilterConfig> {
  return parseJson<FilterConfig>(
    await fetch(`${API_BASE}/filter-configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_key: templateKey, filters }),
    }),
  );
}

export async function uploadFacts(templateKey: string, file: File): Promise<LoadResponse> {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(`${API_BASE}/facts/upload?template_key=${encodeURIComponent(templateKey)}`, {
    method: "POST",
    body: fd,
  });
  return parseJson<LoadResponse>(res);
}

export async function loadDowntimeFacts(): Promise<LoadResponse> {
  return parseJson<LoadResponse>(
    await fetch(`${API_BASE}/facts/load-downtime`, {
      method: "POST",
    }),
  );
}

export async function runAnalysis(mode: "prepare" | "satisfaction"): Promise<AnalysisResponse> {
  return parseJson<AnalysisResponse>(
    await fetch(`${API_BASE}/analysis/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }),
  );
}

export async function exportRows(rows: Record<string, unknown>[], format: "xlsx" | "csv"): Promise<void> {
  const res = await fetch(`${API_BASE}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, format }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `export.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function exportXlsxToSettings(rows: Record<string, unknown>[]): Promise<{ saved_path: string; filename: string }> {
  return parseJson<{ status: string; saved_path: string; filename: string }>(
    await fetch(`${API_BASE}/export/xlsx-to-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, format: "xlsx" }),
    }),
  ).then((r) => ({ saved_path: r.saved_path, filename: r.filename }));
}
