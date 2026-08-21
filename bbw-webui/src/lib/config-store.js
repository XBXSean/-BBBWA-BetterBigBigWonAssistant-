// 配置列表存储(localStorage 持久化):保存并命名多个配置
// 结构: [{ id, name, createdAt, updatedAt, profile }]
// profile = payloadToProfile 输出的可编辑模型(纯 JSON 可序列化)
const LS_KEY = "bbw-configs";

export function loadConfigs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
function persist(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch {}
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/** 保存配置:同名覆盖;返回保存的配置对象 */
export function saveConfig(name, profile) {
  const list = loadConfigs();
  const cleanName = (name || "").trim() || "未命名配置";
  const now = new Date().toISOString();
  let saved;
  const existing = list.find((c) => c.name === cleanName);
  if (existing) {
    existing.profile = profile;
    existing.updatedAt = now;
    saved = existing;
  } else {
    saved = { id: uid(), name: cleanName, createdAt: now, updatedAt: now, profile };
    list.unshift(saved);
  }
  persist(list);
  return saved;
}

export function renameConfig(id, newName) {
  const list = loadConfigs();
  const c = list.find((x) => x.id === id);
  if (!c) return false;
  const n = (newName || "").trim();
  if (n && n !== c.name) c.name = n;
  c.updatedAt = new Date().toISOString();
  persist(list);
  return true;
}

export function deleteConfig(id) {
  const list = loadConfigs();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  persist(list);
  return true;
}

export function clearConfigs() { persist([]); }

/** 导出整个配置列表为 JSON 文本 */
export function exportConfigList() {
  const list = loadConfigs();
  return JSON.stringify({
    type: "bbw-config-list",
    version: 1,
    exportedAt: new Date().toISOString(),
    configs: list.map(({ name, createdAt, updatedAt, profile }) => ({ name, createdAt, updatedAt, profile })),
  }, null, 2);
}

/** 单个配置导出(可独立分享/导入) */
export function exportConfigOne(c) {
  return JSON.stringify({
    type: "bbw-config",
    version: 1,
    name: c.name,
    exportedAt: new Date().toISOString(),
    profile: c.profile,
  }, null, 2);
}

function isProfile(o) {
  return !!o && typeof o === "object"
    && Array.isArray(o.keys)
    && !!o.deadzone && typeof o.deadzone === "object"
    && (Array.isArray(o.curves) || Array.isArray(o.triggers));
}

/**
 * 解析导入文本 → 配置数组 [{name, profile}]。
 * 兼容三种格式:配置列表(bbw-config-list / 数组)、单个配置(bbw-config)、纯 profile。
 * 无法识别时抛错。
 */
export function parseConfigImport(text) {
  const obj = JSON.parse(text);
  const norm = (c, fallback) => {
    if (!c || typeof c !== "object") return null;
    const profile = (c.profile && isProfile(c.profile)) ? c.profile : isProfile(c) ? c : null;
    if (!profile) return null;
    return { name: String(c.name || fallback).trim() || fallback, profile };
  };
  let out = [];
  if (Array.isArray(obj)) {
    out = obj.map((c) => norm(c, "导入配置")).filter(Boolean);
  } else if (obj && Array.isArray(obj.configs)) {
    out = obj.configs.map((c) => norm(c, "导入配置")).filter(Boolean);
  } else {
    const one = norm(obj, "导入配置");
    if (one) out = [one];
  }
  if (!out.length) throw new Error("无法识别:不是 profile JSON 或配置列表");
  return out;
}

/** 合并导入配置进列表(同名覆盖),返回导入数量 */
export function mergeImportedConfigs(configs) {
  const list = loadConfigs();
  const now = new Date().toISOString();
  let n = 0;
  for (const c of configs) {
    const existing = list.find((x) => x.name === c.name);
    if (existing) {
      existing.profile = c.profile;
      existing.updatedAt = now;
    } else {
      list.unshift({ id: uid(), name: c.name, createdAt: c.createdAt || now, updatedAt: now, profile: c.profile });
    }
    n++;
  }
  persist(list);
  return n;
}
