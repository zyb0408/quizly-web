/**
 * settings.js - 设置页面逻辑
 * 直播间配置 + 答题设置 + 主题 + 配置导入导出 + 题目管理
 */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  let filteredList = [];

  const THEMES = ["purple", "blue", "orange", "green", "rose"];

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
      theme: document.querySelector(".theme-item.active")?.dataset.theme || "purple"
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
    exportFile("答题配置.json", Storage.exportConfig(), "application/json");
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
