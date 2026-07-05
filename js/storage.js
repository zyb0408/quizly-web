/**
 * storage.js - 本地持久化存储工具
 * 管理题目库、直播间配置、排行榜数据
 * 所有数据通过 localStorage 持久化，支持离线使用
 */
const Storage = {
  KEYS: {
    CONFIG: "quiz_config",
    QUESTIONS: "quiz_questions",
    LEADERBOARD: "quiz_leaderboard",
    CURRENT_INDEX: "quiz_current_index"
  },

  /* ---------- 直播间配置 ---------- */
  getConfig() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.CONFIG)) || {};
    } catch {
      return {};
    }
  },
  saveConfig(cfg) {
    const merged = { ...this.getConfig(), ...cfg };
    localStorage.setItem(this.KEYS.CONFIG, JSON.stringify(merged));
    return merged;
  },
  /** 导出配置（不含题目），返回 JSON 字符串 */
  exportConfig() {
    return JSON.stringify(this.getConfig(), null, 2);
  },
  /** 导入配置 JSON（合并覆盖） */
  importConfig(jsonStr, replace = false) {
    let incoming = {};
    if (typeof jsonStr === "string") incoming = JSON.parse(jsonStr);
    else if (typeof jsonStr === "object") incoming = jsonStr;
    const merged = replace ? incoming : { ...this.getConfig(), ...incoming };
    localStorage.setItem(this.KEYS.CONFIG, JSON.stringify(merged));
    return merged;
  },
  /** 应用主题（在 <html> 上设置 data-theme） */
  applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme || "purple");
  },

  /* ---------- 题目库 ---------- */
  getQuestions() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.QUESTIONS)) || [];
    } catch {
      return [];
    }
  },
  saveQuestions(list) {
    localStorage.setItem(this.KEYS.QUESTIONS, JSON.stringify(list));
  },
  addQuestion(q) {
    const list = this.getQuestions();
    q.id = q.id || ("q" + Date.now() + Math.random().toString(36).slice(2, 6));
    list.push(q);
    this.saveQuestions(list);
    return q;
  },
  deleteQuestion(id) {
    const list = this.getQuestions().filter((q) => q.id !== id);
    this.saveQuestions(list);
  },
  deleteByIds(ids) {
    const set = new Set(ids);
    const list = this.getQuestions().filter((q) => !set.has(q.id));
    this.saveQuestions(list);
    return list;
  },
  /** 条件查询：按科目 / 关键词过滤 */
  queryQuestions({ subject = "", keyword = "" } = {}) {
    let list = this.getQuestions();
    if (subject) list = list.filter((q) => q.subject === subject);
    if (keyword) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter((q) =>
        [q.question, q.a, q.b, q.c, q.d, q.seq].some(
          (v) => (v || "").toString().toLowerCase().includes(kw)
        )
      );
    }
    return list;
  },
  /** 批量导入（合并去重，按 科目+序号 判重） */
  importQuestions(rows, replace = false) {
    let base = replace ? [] : this.getQuestions();
    const existKeys = new Set(base.map((q) => `${q.subject}|${q.seq}`));
    let added = 0, skipped = 0;
    rows.forEach((r) => {
      const q = this._normalizeRow(r);
      if (!q) { skipped++; return; }
      const key = `${q.subject}|${q.seq}`;
      if (existKeys.has(key)) { skipped++; return; }
      existKeys.add(key);
      q.id = "q" + Date.now() + Math.random().toString(36).slice(2, 6) + added;
      base.push(q);
      added++;
    });
    this.saveQuestions(base);
    return { added, skipped, total: base.length };
  },
  _normalizeRow(r) {
    // 兼容中英文字段名
    const get = (keys) => {
      for (const k of keys) {
        if (r[k] !== undefined && r[k] !== "") return r[k];
      }
      return "";
    };
    const subject = get(["科目", "subject", "Subject"]);
    const seq = get(["序号", "seq", "Seq", "no", "No"]);
    const question = get(["题目", "question", "Question", "title"]);
    const a = get(["选项A", "A", "a", "optionA"]);
    const b = get(["选项B", "B", "b", "optionB"]);
    const c = get(["选项C", "C", "c", "optionC"]);
    const d = get(["选项D", "D", "d", "optionD"]);
    let answer = get(["正确答案", "answer", "Answer", "correct"]);
    answer = (answer || "").toString().trim().toUpperCase();
    if (answer && !["A", "B", "C", "D"].includes(answer)) {
      // 若答案是选项文本，则匹配
      if (answer === a) answer = "A";
      else if (answer === b) answer = "B";
      else if (answer === c) answer = "C";
      else if (answer === d) answer = "D";
    }
    if (!question) return null;
    return { subject, seq, question, a, b, c, d, answer };
  },
  /** 导出为 CSV */
  exportCSV() {
    const list = this.getQuestions();
    const header = ["科目", "序号", "题目", "选项A", "选项B", "选项C", "选项D", "正确答案"];
    const esc = (v) => `"${(v || "").toString().replace(/"/g, '""')}"`;
    const lines = [header.join(",")];
    list.forEach((q) => {
      lines.push([q.subject, q.seq, q.question, q.a, q.b, q.c, q.d, q.answer].map(esc).join(","));
    });
    return lines.join("\n");
  },
  /** 导出为 JSON */
  exportJSON() {
    return JSON.stringify(this.getQuestions(), null, 2);
  },

  /* ---------- 排行榜 ---------- */
  getLeaderboard() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.LEADERBOARD)) || {};
    } catch {
      return {};
    }
  },
  saveLeaderboard(lb) {
    localStorage.setItem(this.KEYS.LEADERBOARD, JSON.stringify(lb));
  },
  /** 增加分数 */
  addScore(nickname, score) {
    const lb = this.getLeaderboard();
    lb[nickname] = (lb[nickname] || 0) + score;
    this.saveLeaderboard(lb);
    return lb[nickname];
  },
  /** 重置排行榜 */
  resetLeaderboard() {
    this.saveLeaderboard({});
  },
  /** 排行榜排序数组 */
  leaderboardSorted() {
    return Object.entries(this.getLeaderboard())
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score);
  },

  /* ---------- 当前题号 ---------- */
  getCurrentIndex() {
    return parseInt(localStorage.getItem(this.KEYS.CURRENT_INDEX)) || 0;
  },
  setCurrentIndex(i) {
    localStorage.setItem(this.KEYS.CURRENT_INDEX, String(i));
  }
};

// CSV 解析（简单实现，支持引号转义）
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch === "\r") { /* skip */ }
      else field += ch;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // 过滤空行
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// CSV 行转对象（首行为表头）
function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] || "").trim(); });
    return obj;
  });
}

if (typeof window !== "undefined") {
  window.Storage = Storage;
  window.parseCSV = parseCSV;
  window.csvToObjects = csvToObjects;
}
