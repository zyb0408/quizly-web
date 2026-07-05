/**
 * settings.js - 设置页面逻辑
 * 直播间配置 + 题目管理（导入/导出/删除/查询）
 */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  let filteredList = []; // 当前表格展示的题目

  /* ---------- 初始化 ---------- */
  function init() {
    loadConfig();
    renderSubjects();
    queryAndRender();
    bindEvents();
  }

  /* ---------- 直播间配置 ---------- */
  function loadConfig() {
    const cfg = Storage.getConfig();
    $("#cfg-room-name").value = cfg.roomName || "";
    $("#cfg-room-id").value = cfg.roomId || "";
    $("#cfg-cookie").value = cfg.cookie || "";
    $("#cfg-host").value = cfg.host || "127.0.0.1";
    $("#cfg-port").value = cfg.port || 1088;
  }

  function saveConfig() {
    const cfg = {
      roomName: $("#cfg-room-name").value.trim(),
      roomId: $("#cfg-room-id").value.trim(),
      cookie: $("#cfg-cookie").value.trim(),
      host: $("#cfg-host").value.trim() || "127.0.0.1",
      port: parseInt($("#cfg-port").value) || 1088
    };
    Storage.saveConfig(cfg);
    toast("配置已保存");
  }

  function testConnect() {
    saveConfig();
    const cfg = Storage.getConfig();
    if (!cfg.roomId) { toast("请先填写直播间 ID"); return; }
    if (typeof DouyinLiveWS === "undefined") {
      toast("SDK 未加载，无法测试"); return;
    }
    toast("正在测试连接...");
    const test = new DouyinLiveWS({
      roomId: cfg.roomId, host: cfg.host, port: cfg.port, cookie: cfg.cookie,
      autoReconnect: false
    });
    let done = false;
    test.on("connected", () => { if (!done) { done = true; toast("连接成功 ✓"); test.destroy(); } });
    test.on("live_status", () => { if (!done) { done = true; toast("已连接到弹幕服务 ✓"); setTimeout(() => test.destroy(), 500); } });
    test.on("error", () => { if (!done) { done = true; toast("连接失败，请确认服务已启动"); } });
    test.connect();
    setTimeout(() => { if (!done) { done = true; toast("连接超时，请确认服务已启动"); test.destroy(); } }, 5000);
  }

  /* ---------- 题目管理 ---------- */
  function renderSubjects() {
    const subjects = [...new Set(Storage.getQuestions().map((q) => q.subject).filter(Boolean))];
    const sel = $("#filter-subject");
    sel.innerHTML = '<option value="">全部</option>' +
      subjects.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
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
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state">暂无题目，请导入或前往导入 CSV/JSON</td></tr>`;
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

  /* ---------- 导入 ---------- */
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
      };
      reader.readAsText(file, "UTF-8");
      input.value = "";
    };
    input.click();
  }

  /* ---------- 导出 ---------- */
  function exportFile(filename, content, mime) {
    const blob = new Blob(["\ufeff" + content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast("已导出 " + filename);
  }

  /* ---------- 删除 ---------- */
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

  /* ---------- 事件 ---------- */
  function bindEvents() {
    $("#btn-save-config").addEventListener("click", saveConfig);
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

    // 全选
    $("#check-all").addEventListener("change", (e) => {
      document.querySelectorAll(".row-check").forEach((c) => (c.checked = e.target.checked));
    });

    // 表格删除按钮（事件委托）
    $("#q-tbody").addEventListener("click", (e) => {
      const btn = e.target.closest('[data-act="del"]');
      if (btn) deleteOne(btn.dataset.id);
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
