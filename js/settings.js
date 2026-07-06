/**
 * settings.js - 设置页面逻辑
 * 直播间配置 + 答题设置 + 主题 + 配置导入导出 + 题目管理
 */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  let filteredList = [];
  let previewList = []; // AI 生成的题目预览列表

  const THEMES = ["purple", "blue", "orange", "green", "rose", "cyan", "amber", "indigo", "emerald", "fuchsia"];

  /* ---------- 初始化 ---------- */
  function init() {
    loadConfig();
    renderSubjects();
    queryAndRender();
    bindEvents();
  }

  /* ---------- 配置加载/保存 ---------- */
  function loadConfig() {
    const cfg = Storage.getConfig();
    $("#cfg-room-name").value = cfg.roomName || "";
    $("#cfg-room-id").value = cfg.roomId || "";
    $("#cfg-cookie").value = cfg.cookie || "";
    $("#cfg-host").value = cfg.host || "127.0.0.1";
    $("#cfg-port").value = cfg.port || 1088;
    $("#cfg-countdown").value = cfg.countdown || 15;

    // 答题模式
    setSeg("#seg-answer-mode", cfg.answerMode || "manual");

    // 科目答题开关
    const subjOn = !!cfg.subjectMode;
    $("#sw-subject-mode").classList.toggle("on", subjOn);
    $("#subject-filter-wrap").style.display = subjOn ? "block" : "none";

    // 主题
    const theme = cfg.theme || "purple";
    Storage.applyTheme(theme);
    document.querySelectorAll(".theme-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.theme === theme);
    });

    // LLM 配置
    $("#llm-base-url").value = cfg.llmBaseUrl || "";
    $("#llm-api-key").value = cfg.llmApiKey || "";
    $("#llm-model").value = cfg.llmModel || "";

    // 科目 datalist（生成题目用）
    renderSubjectDatalist();
  }

  function renderSubjectDatalist() {
    const subjects = [...new Set(Storage.getQuestions().map((q) => q.subject).filter(Boolean))];
    $("#gen-subject-list").innerHTML =
      subjects.map((s) => `<option value="${escapeAttr(s)}">`).join("");
  }

  function collectConfig() {
    return {
      roomName: $("#cfg-room-name").value.trim(),
      roomId: $("#cfg-room-id").value.trim(),
      cookie: $("#cfg-cookie").value.trim(),
      host: $("#cfg-host").value.trim() || "127.0.0.1",
      port: parseInt($("#cfg-port").value) || 1088,
      countdown: parseInt($("#cfg-countdown").value) || 15,
      answerMode: $("#seg-answer-mode .active").dataset.val,
      subjectMode: $("#sw-subject-mode").classList.contains("on"),
      subjectFilter: $("#cfg-subject-filter").value,
      theme: document.querySelector(".theme-item.active")?.dataset.theme || "purple",
      llmBaseUrl: $("#llm-base-url").value.trim(),
      llmApiKey: $("#llm-api-key").value.trim(),
      llmModel: $("#llm-model").value.trim()
    };
  }

  function saveConfig(silent) {
    const cfg = collectConfig();
    Storage.saveConfig(cfg);
    Storage.applyTheme(cfg.theme);
    if (!silent) toast("配置已保存");
    return cfg;
  }

  function setSeg(sel, val) {
    document.querySelectorAll(sel + " button").forEach((b) => {
      b.classList.toggle("active", b.dataset.val === val);
    });
  }

  /* ---------- 测试连接 ---------- */
  function testConnect() {
    saveConfig(true);
    const cfg = Storage.getConfig();
    if (!cfg.roomId) { toast("请先填写直播间 ID"); return; }
    if (typeof DouyinLiveWS === "undefined") { toast("SDK 未加载"); return; }
    toast("正在测试连接...");
    const test = new DouyinLiveWS({
      roomId: cfg.roomId, host: cfg.host, port: cfg.port, cookie: cfg.cookie,
      autoReconnect: false
    });
    let done = false;
    const finish = (ok, msg) => {
      if (done) return; done = true;
      toast(msg);
      try { test.destroy(); } catch (e) {}
    };
    test.on("connected", () => finish(true, "连接成功 ✓"));
    test.on("live_status", (d) => finish(true, "已连接：" + (d.message || "弹幕服务就绪")));
    test.on("error", () => finish(false, "连接失败，请确认服务已启动"));
    test.connect();
    setTimeout(() => finish(false, "连接超时，请确认服务已启动"), 5000);
  }

  /* ---------- 题目管理 ---------- */
  function renderSubjects() {
    const subjects = [...new Set(Storage.getQuestions().map((q) => q.subject).filter(Boolean))];
    const optHTML = (sel) =>
      '<option value="">全部</option>' +
      subjects.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
    $("#filter-subject").innerHTML = optHTML();
    // 答题科目下拉（不含"全部"）
    const cur = Storage.getConfig().subjectFilter;
    $("#cfg-subject-filter").innerHTML =
      '<option value="">请选择科目</option>' +
      subjects.map((s) => `<option value="${escapeAttr(s)}"${s === cur ? " selected" : ""}>${escapeHtml(s)}</option>`).join("");
  }

  function queryAndRender() {
    const subject = $("#filter-subject").value;
    const keyword = $("#filter-keyword").value;
    filteredList = Storage.queryQuestions({ subject, keyword });
    renderTable(filteredList);
  }

  function renderTable(list) {
    const tbody = $("#q-tbody");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state">暂无题目，请导入 CSV/JSON</td></tr>`;
    } else {
      tbody.innerHTML = list.map((q) => `
        <tr data-id="${escapeAttr(q.id)}">
          <td><input type="checkbox" class="row-check" data-id="${escapeAttr(q.id)}"></td>
          <td>${escapeHtml(q.subject)}</td>
          <td>${escapeHtml(q.seq)}</td>
          <td class="content">${escapeHtml(q.question)}</td>
          <td class="content">${escapeHtml(q.a)}</td>
          <td class="content">${escapeHtml(q.b)}</td>
          <td class="content">${escapeHtml(q.c)}</td>
          <td class="content">${escapeHtml(q.d)}</td>
          <td><b style="color:#22c55e">${escapeHtml(q.answer)}</b></td>
          <td><button class="btn btn-danger" style="padding:3px 8px;font-size:11px" data-act="del" data-id="${escapeAttr(q.id)}">删除</button></td>
        </tr>
      `).join("");
    }
    const total = Storage.getQuestions().length;
    $("#q-count").textContent = `共 ${total} 题，当前显示 ${list.length} 题`;
    $("#check-all").checked = false;
  }

  /* ---------- 题目导入 ---------- */
  function handleImport() {
    const input = $("#file-input");
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target.result;
        let rows = [];
        try {
          if (file.name.endsWith(".json")) {
            const data = JSON.parse(text);
            rows = Array.isArray(data) ? data : [data];
          } else {
            rows = csvToObjects(text);
          }
        } catch (err) {
          toast("文件解析失败：" + err.message);
          return;
        }
        const replace = confirm(
          `解析到 ${rows.length} 条题目。\n点击「确定」追加导入，点击「取消」替换全部题库。\n（相同 科目+序号 会自动去重）`
        );
        const res = Storage.importQuestions(rows, !replace);
        toast(`导入完成：新增 ${res.added}，跳过 ${res.skipped}，共 ${res.total} 题`);
        renderSubjects();
        queryAndRender();
        // 导入后滚动回顶部，便于返回主页
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
      reader.readAsText(file, "UTF-8");
      input.value = "";
    };
    input.click();
  }

  /* ---------- 题目导出 ---------- */
  function exportFile(filename, content, mime) {
    const blob = new Blob(["\ufeff" + content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast("已导出 " + filename);
  }

  /* ---------- 题目删除 ---------- */
  function deleteSelected() {
    const ids = [...document.querySelectorAll(".row-check:checked")].map((c) => c.dataset.id);
    if (!ids.length) { toast("请先勾选要删除的题目"); return; }
    if (!confirm(`确定删除选中的 ${ids.length} 道题目？`)) return;
    Storage.deleteByIds(ids);
    toast(`已删除 ${ids.length} 题`);
    renderSubjects();
    queryAndRender();
  }

  function deleteAll() {
    const total = Storage.getQuestions().length;
    if (!total) { toast("题库为空"); return; }
    if (!confirm(`确定清空全部 ${total} 道题目？此操作不可恢复！`)) return;
    Storage.saveQuestions([]);
    toast("已清空全部题目");
    renderSubjects();
    queryAndRender();
  }

  function deleteOne(id) {
    Storage.deleteQuestion(id);
    toast("已删除");
    renderSubjects();
    queryAndRender();
  }

  /* ---------- 配置导入导出 ---------- */
  function exportConfig() {
    saveConfig(true);
    // 导出时移除 API Key 等敏感信息
    const cfg = JSON.parse(Storage.exportConfig());
    delete cfg.llmApiKey;
    exportFile("答题配置.json", JSON.stringify(cfg, null, 2), "application/json");
  }

  function importConfig() {
    const input = $("#config-file-input");
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          Storage.importConfig(ev.target.result);
          loadConfig();
          renderSubjects();
          toast("配置导入成功");
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (err) {
          toast("配置文件解析失败：" + err.message);
        }
      };
      reader.readAsText(file, "UTF-8");
      input.value = "";
    };
    input.click();
  }

  /* ---------- LLM 生成题目 ---------- */

  /** 获取模型列表 */
  async function fetchModels() {
    saveConfig(true);
    const cfg = Storage.getConfig();
    const baseUrl = (cfg.llmBaseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) { toast("请填写 API Base URL"); return; }
    if (!cfg.llmApiKey) { toast("请填写 API Key"); return; }
    toast("正在获取模型列表...");
    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${cfg.llmApiKey}` }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const models = (data.data || data || [])
        .map((m) => m.id || m.name)
        .filter(Boolean);
      $("#llm-model-list").innerHTML = models.map((m) => `<option value="${escapeAttr(m)}">`).join("");
      toast(`获取到 ${models.length} 个模型`);
      if (models.length && !cfg.llmModel) $("#llm-model").value = models[0];
    } catch (err) {
      toast("获取失败：" + err.message + "（可手动填写模型名）");
    }
  }

  /** 计算答案分布 */
  function calcDistribution(count, mode) {
    if (mode === "custom") {
      return {
        A: parseInt($("#dist-a").value) || 0,
        B: parseInt($("#dist-b").value) || 0,
        C: parseInt($("#dist-c").value) || 0,
        D: parseInt($("#dist-d").value) || 0
      };
    }
    if (mode === "random") {
      const dist = { A: 0, B: 0, C: 0, D: 0 };
      const keys = ["A", "B", "C", "D"];
      for (let i = 0; i < count; i++) dist[keys[Math.floor(Math.random() * 4)]]++;
      return dist;
    }
    // even：均匀分布
    const base = Math.floor(count / 4);
    const rem = count - base * 4;
    const dist = { A: base, B: base, C: base, D: base };
    ["A", "B", "C", "D"].slice(0, rem).forEach((k) => dist[k]++);
    return dist;
  }

  /** 生成题目 */
  async function generateQuestions() {
    saveConfig(true);
    const cfg = Storage.getConfig();
    const baseUrl = (cfg.llmBaseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) { toast("请填写 API Base URL"); return; }
    if (!cfg.llmApiKey) { toast("请填写 API Key"); return; }
    if (!cfg.llmModel) { toast("请填写或选择模型"); return; }
    const subject = $("#gen-subject").value.trim();
    if (!subject) { toast("请填写科目"); return; }
    const count = Math.min(50, Math.max(1, parseInt($("#gen-count").value) || 5));
    const distMode = $("#seg-dist .active").dataset.val;
    const dist = calcDistribution(count, distMode);
    const requirement = $("#gen-requirement").value.trim();

    const status = $("#gen-status");
    status.textContent = "生成中，请稍候...";
    $("#btn-generate").disabled = true;
    $("#btn-import-preview").disabled = true;

    const distText = `A=${dist.A}, B=${dist.B}, C=${dist.C}, D=${dist.D}`;
    const prompt = `请生成 ${count} 道关于「${subject}」科目的单项选择题。
${requirement ? "额外要求：" + requirement + "\n" : ""}正确答案数量分布：${distText}（即正确答案为 A 的 ${dist.A} 题，为 B 的 ${dist.B} 题，为 C 的 ${dist.C} 题，为 D 的 ${dist.D} 题，总数 ${count}）。
每道题必须包含字段：subject(科目，固定为"${subject}")、question(题干)、a/b/c/d(四个选项的文本)、answer(正确答案字母，取值 A/B/C/D 之一)。
四个选项要具有迷惑性，有且只有一个正确答案。题干和选项用中文。
严格只返回如下 JSON，不要输出任何额外文字或代码块标记：
{"questions":[{"subject":"${subject}","question":"","a":"","b":"","c":"","d":"","answer":"A"}]}`;

    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.llmApiKey}` },
        body: JSON.stringify({
          model: cfg.llmModel,
          messages: [
            { role: "system", content: "你是题目生成助手，只返回合法 JSON 对象，不要输出任何额外文字、解释或代码块标记。" },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          response_format: { type: "json_object" }
        })
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      }
      const data = await resp.json();
      const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
      const parsed = parseLLMJson(content);
      if (!parsed.questions || !parsed.questions.length) throw new Error("模型未返回有效题目");
      previewList = parsed.questions.map((q, i) => normalizePreview(q, subject, i));
      renderPreview();
      status.textContent = `已生成 ${previewList.length} 题，请审核后导入`;
      $("#btn-import-preview").disabled = false;
      toast(`生成 ${previewList.length} 题，请审核`);
    } catch (err) {
      status.textContent = "生成失败：" + err.message;
      toast("生成失败：" + err.message);
    } finally {
      $("#btn-generate").disabled = false;
    }
  }

  /** 容错解析模型返回的 JSON */
  function parseLLMJson(content) {
    try { return JSON.parse(content); } catch (e) {}
    const m1 = content.match(/\{[\s\S]*\}/);
    if (m1) { try { return JSON.parse(m1[0]); } catch (e) {} }
    const m2 = content.match(/\[[\s\S]*\]/);
    if (m2) { try { return { questions: JSON.parse(m2[0]) }; } catch (e) {} }
    return {};
  }

  /** 规范化预览题目字段 */
  function normalizePreview(q, subject, i) {
    const get = (keys) => {
      for (const k of keys) if (q[k] !== undefined && q[k] !== "") return q[k];
      return "";
    };
    let answer = (get(["answer", "正确答案", "Answer"]) || "").toString().trim().toUpperCase();
    const a = get(["a", "A", "选项A", "optionA"]);
    const b = get(["b", "B", "选项B", "optionB"]);
    const c = get(["c", "C", "选项C", "optionC"]);
    const d = get(["d", "D", "选项D", "optionD"]);
    if (answer && !["A", "B", "C", "D"].includes(answer)) {
      if (answer === a) answer = "A";
      else if (answer === b) answer = "B";
      else if (answer === c) answer = "C";
      else if (answer === d) answer = "D";
    }
    return {
      id: "pv_" + Date.now() + "_" + i,
      subject: get(["subject", "科目"]) || subject,
      seq: get(["seq", "序号"]) || String(i + 1),
      question: get(["question", "题目", "title"]) || "",
      a, b, c, d, answer
    };
  }

  /** 渲染预览表格 */
  function renderPreview() {
    const tbody = $("#preview-tbody");
    $("#preview-wrap").style.display = previewList.length ? "block" : "none";
    if (!previewList.length) {
      tbody.innerHTML = "";
      $("#preview-count").textContent = "";
      return;
    }
    const inputStyle = "width:100%;padding:3px 4px;font-size:11px;background:#0f172a;color:var(--text);border:1px solid rgba(148,163,184,.2);border-radius:4px";
    tbody.innerHTML = previewList.map((q) => `
      <tr data-id="${escapeAttr(q.id)}">
        <td><input type="checkbox" class="pv-check" data-id="${escapeAttr(q.id)}" checked></td>
        <td><input class="pv-edit" data-field="subject" value="${escapeAttr(q.subject)}" style="${inputStyle};width:70px"></td>
        <td class="content"><input class="pv-edit" data-field="question" value="${escapeAttr(q.question)}" style="${inputStyle}"></td>
        <td class="content"><input class="pv-edit" data-field="a" value="${escapeAttr(q.a)}" style="${inputStyle};min-width:70px"></td>
        <td class="content"><input class="pv-edit" data-field="b" value="${escapeAttr(q.b)}" style="${inputStyle};min-width:70px"></td>
        <td class="content"><input class="pv-edit" data-field="c" value="${escapeAttr(q.c)}" style="${inputStyle};min-width:70px"></td>
        <td class="content"><input class="pv-edit" data-field="d" value="${escapeAttr(q.d)}" style="${inputStyle};min-width:70px"></td>
        <td><select class="pv-edit" data-field="answer" style="padding:3px;font-size:11px;background:#0f172a;color:var(--text);border:1px solid rgba(148,163,184,.2);border-radius:4px">
          ${["A", "B", "C", "D"].map((x) => `<option ${x === q.answer ? "selected" : ""}>${x}</option>`).join("")}
        </select></td>
        <td><button class="btn btn-danger" style="padding:3px 8px;font-size:11px" data-act="pv-del" data-id="${escapeAttr(q.id)}">删除</button></td>
      </tr>
    `).join("");
    updatePreviewCount();
  }

  function updatePreviewCount() {
    const checked = document.querySelectorAll(".pv-check:checked").length;
    $("#preview-count").textContent = `预览 ${previewList.length} 题（已勾选 ${checked} 题）`;
  }

  /** 同步预览表格的编辑值到 previewList */
  function syncPreviewEdits() {
    document.querySelectorAll(".pv-edit").forEach((el) => {
      const tr = el.closest("tr");
      const id = tr.dataset.id;
      const field = el.dataset.field;
      const item = previewList.find((q) => q.id === id);
      if (item) item[field] = el.value;
    });
  }

  /** 删除预览题目 */
  function deletePreview(id) {
    syncPreviewEdits();
    previewList = previewList.filter((q) => q.id !== id);
    renderPreview();
    if (!previewList.length) $("#btn-import-preview").disabled = true;
  }

  /** 导入预览题目到题库 */
  function importPreview() {
    syncPreviewEdits();
    const checkedIds = [...document.querySelectorAll(".pv-check:checked")].map((c) => c.dataset.id);
    const rows = previewList.filter((q) => checkedIds.includes(q.id));
    if (!rows.length) { toast("请至少勾选一道题目"); return; }
    const res = Storage.importQuestions(rows, false);
    toast(`已导入 ${res.added} 题（跳过重复 ${res.skipped}）`);
    renderSubjects();
    queryAndRender();
    renderSubjectDatalist();
    previewList = previewList.filter((q) => !checkedIds.includes(q.id));
    renderPreview();
    if (!previewList.length) {
      $("#btn-import-preview").disabled = true;
      $("#gen-status").textContent = `已导入 ${res.added} 题到题库`;
    } else {
      $("#gen-status").textContent = `已导入 ${res.added} 题，剩余 ${previewList.length} 题待审核`;
    }
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    $("#btn-save-config").addEventListener("click", () => saveConfig(false));
    $("#btn-test-config").addEventListener("click", testConnect);
    $("#btn-import-csv").addEventListener("click", handleImport);
    $("#btn-import-json").addEventListener("click", handleImport);
    $("#btn-export-csv").addEventListener("click", () =>
      exportFile("题目库.csv", Storage.exportCSV(), "text/csv;charset=utf-8"));
    $("#btn-export-json").addEventListener("click", () =>
      exportFile("题目库.json", Storage.exportJSON(), "application/json"));
    $("#btn-delete-selected").addEventListener("click", deleteSelected);
    $("#btn-delete-all").addEventListener("click", deleteAll);
    $("#btn-query").addEventListener("click", queryAndRender);
    $("#filter-keyword").addEventListener("keyup", (e) => {
      if (e.key === "Enter") queryAndRender();
    });
    $("#check-all").addEventListener("change", (e) => {
      document.querySelectorAll(".row-check").forEach((c) => (c.checked = e.target.checked));
    });
    $("#q-tbody").addEventListener("click", (e) => {
      const btn = e.target.closest('[data-act="del"]');
      if (btn) deleteOne(btn.dataset.id);
    });

    // 答题模式分段（自动保存）
    $("#seg-answer-mode").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) {
        setSeg("#seg-answer-mode", b.dataset.val);
        saveConfig(true);
        toast("答题模式已保存：" + (b.dataset.val === "auto" ? "自动" : "手动"));
      }
    });

    // 科目答题开关（自动保存）
    $("#sw-subject-mode").addEventListener("click", () => {
      const sw = $("#sw-subject-mode");
      const on = !sw.classList.contains("on");
      sw.classList.toggle("on", on);
      $("#subject-filter-wrap").style.display = on ? "block" : "none";
      saveConfig(true);
      toast(on ? "已开启科目答题" : "已关闭科目答题（随机）");
    });

    // 科目选择 / 倒计时（自动保存）
    $("#cfg-subject-filter").addEventListener("change", () => { saveConfig(true); toast("科目已保存"); });
    $("#cfg-countdown").addEventListener("change", () => { saveConfig(true); toast("倒计时已保存"); });

    // 主题选择（实时预览 + 自动保存）
    $("#theme-grid").addEventListener("click", (e) => {
      const item = e.target.closest(".theme-item");
      if (!item) return;
      document.querySelectorAll(".theme-item").forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      Storage.applyTheme(item.dataset.theme);
      saveConfig(true);
      toast("主题已保存");
    });

    // 直播间配置项失焦自动保存
    ["#cfg-room-name", "#cfg-room-id", "#cfg-cookie", "#cfg-host", "#cfg-port"].forEach((sel) => {
      $(sel).addEventListener("change", () => saveConfig(true));
    });

    // 配置导入导出
    $("#btn-export-config").addEventListener("click", exportConfig);
    $("#btn-import-config").addEventListener("click", importConfig);

    // LLM 配置项自动保存
    ["#llm-base-url", "#llm-api-key", "#llm-model"].forEach((sel) => {
      $(sel).addEventListener("change", () => saveConfig(true));
    });

    // 获取模型列表
    $("#btn-fetch-models").addEventListener("click", fetchModels);

    // 答案分布切换
    $("#seg-dist").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      document.querySelectorAll("#seg-dist button").forEach((x) => x.classList.toggle("active", x === b));
      $("#dist-custom").style.display = b.dataset.val === "custom" ? "flex" : "none";
    });

    // 生成题目
    $("#btn-generate").addEventListener("click", generateQuestions);

    // 导入预览题目
    $("#btn-import-preview").addEventListener("click", importPreview);

    // 预览全选
    $("#check-all-preview").addEventListener("change", (e) => {
      document.querySelectorAll(".pv-check").forEach((c) => (c.checked = e.target.checked));
      updatePreviewCount();
    });

    // 预览表格：删除 + 勾选统计
    $("#preview-tbody").addEventListener("click", (e) => {
      const btn = e.target.closest('[data-act="pv-del"]');
      if (btn) deletePreview(btn.dataset.id);
    });
    $("#preview-tbody").addEventListener("change", (e) => {
      if (e.target.classList.contains("pv-check")) updatePreviewCount();
    });
  }

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return (s || "").toString()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "&#39;"); }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
