/**
 * app.js - 主答题页面逻辑
 * 负责：题目展示、ABCD 选项、倒计时、弹幕答案监听、排行榜计分
 */
(function () {
  "use strict";

  const COUNTDOWN_SECONDS = 15; // 默认答题时长
  const CORRECT_SCORE = 10;     // 答对基础分

  // 题库与配置
  let questions = [];
  let currentIdx = 0;
  let config = {};

  // 答题状态
  let answering = false;        // 是否正在答题（倒计时中）
  let timeLeft = 0;
  let timerHandle = null;
  let answeredUsers = new Map(); // nickname -> { choice, correct, time }
  let optionCounts = { A: 0, B: 0, C: 0, D: 0 };
  let client = null;

  /* ---------- DOM ---------- */
  const $ = (s) => document.querySelector(s);
  const elRoomName = $("#room-name");
  const elStatus = $("#conn-status");
  const elStatusDot = $("#status-dot");
  const elQMeta = $("#q-meta");
  const elQText = $("#q-text");
  const elOptions = $("#options");
  const elTimerNum = $("#timer-num");
  const elTimerCircle = $("#timer-circle");
  const elHint = $("#hint");
  const elBtnPrev = $("#btn-prev");
  const elBtnNext = $("#btn-next");
  const elBtnStart = $("#btn-start");
  const elBtnReset = $("#btn-reset");
  const elLbList = $("#lb-list");
  const elStats = $("#stats-bar");
  const elLiveBadge = $("#live-badge");

  /* ---------- 初始化 ---------- */
  function init() {
    config = Storage.getConfig();
    questions = Storage.getQuestions();
    currentIdx = Storage.getCurrentIndex();

    // 直播间名称
    elRoomName.textContent = config.roomName || "未配置直播间";

    // 注册 Service Worker (PWA)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch((e) =>
        console.warn("SW 注册失败:", e)
      );
    }

    renderQuestion();
    renderLeaderboard();
    bindEvents();
    connectLive();
  }

  /* ---------- 连接直播间弹幕 ---------- */
  function connectLive() {
    if (!config.roomId) {
      setConnStatus(false, "未配置直播间ID，请前往设置");
      return;
    }
    if (typeof DouyinLiveWS === "undefined") {
      setConnStatus(false, "SDK 未加载");
      return;
    }
    client = new DouyinLiveWS({
      roomId: config.roomId,
      host: config.host || "127.0.0.1",
      port: config.port || 1088,
      cookie: config.cookie || ""
    });
    client.on("connected", () => setConnStatus(true, "已连接弹幕服务"));
    client.on("live_status", (data) => {
      setConnStatus(!!data.live, data.message || (data.live ? "直播中" : "未开播"));
      if (data.live) elLiveBadge.style.display = "block";
      else elLiveBadge.style.display = "none";
    });
    client.on("disconnected", () => setConnStatus(false, "连接断开，重连中..."));
    client.on("WebcastChatMessage", onChatMessage);
    client.connect();
  }

  function setConnStatus(on, msg) {
    elStatusDot.classList.toggle("on", on);
    elStatus.textContent = msg || (on ? "已连接" : "未连接");
  }

  /* ---------- 弹幕答案处理 ---------- */
  function onChatMessage(msg) {
    const nickname = (msg.user && msg.user.nickname) || "匿名";
    const content = (msg.content || "").trim().toUpperCase();

    // 答题中，且内容是 A/B/C/D
    if (answering && /^[ABCD]$/.test(content)) {
      if (answeredUsers.has(nickname)) return; // 每人每题一次
      const q = questions[currentIdx];
      if (!q) return;
      const correct = content === q.answer;
      answeredUsers.set(nickname, { choice: content, correct, time: Date.now() });
      optionCounts[content] = (optionCounts[content] || 0) + 1;
      if (correct) {
        // 剩余时间越多得分越高
        const bonus = Math.round((timeLeft / COUNTDOWN_SECONDS) * CORRECT_SCORE);
        Storage.addScore(nickname, CORRECT_SCORE + bonus);
      }
      renderOptions();
      renderLeaderboard();
      renderStats();
    }
  }

  /* ---------- 题目渲染 ---------- */
  function renderQuestion() {
    if (!questions.length) {
      elQMeta.innerHTML = "";
      elQText.textContent = "暂无题目，请前往设置导入题库";
      elOptions.innerHTML = "";
      return;
    }
    if (currentIdx >= questions.length) currentIdx = questions.length - 1;
    if (currentIdx < 0) currentIdx = 0;
    const q = questions[currentIdx];
    elQMeta.innerHTML = "";
    if (q.subject) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = q.subject;
      elQMeta.appendChild(tag);
    }
    const seqTag = document.createElement("span");
    seqTag.className = "tag";
    seqTag.textContent = `第 ${currentIdx + 1}/${questions.length} 题`;
    elQMeta.appendChild(seqTag);
    if (q.seq) {
      const s = document.createElement("span");
      s.className = "tag";
      s.textContent = "序号 " + q.seq;
      elQMeta.appendChild(s);
    }
    elQText.textContent = q.question;
    renderOptions();
    Storage.setCurrentIndex(currentIdx);
  }

  function renderOptions() {
    const q = questions[currentIdx];
    elOptions.innerHTML = "";
    if (!q) return;
    ["A", "B", "C", "D"].forEach((key) => {
      const text = q[key.toLowerCase()] || q[key] || "";
      if (!text) return;
      const div = document.createElement("div");
      div.className = "option";
      if (answering === false && q.answer && q._revealed) {
        if (key === q.answer) div.classList.add("correct");
      }
      const count = optionCounts[key] || 0;
      div.innerHTML = `
        <div class="letter">${key}</div>
        <div class="opt-text">${escapeHtml(text)}</div>
        ${answering || q._revealed ? `<div class="count">${count}人</div>` : ""}
      `;
      elOptions.appendChild(div);
    });
  }

  /* ---------- 倒计时 ---------- */
  function startAnswer() {
    const q = questions[currentIdx];
    if (!q) { toast("没有题目"); return; }
    if (!q.answer) { toast("本题未设置正确答案"); return; }

    answering = true;
    timeLeft = COUNTDOWN_SECONDS;
    answeredUsers.clear();
    optionCounts = { A: 0, B: 0, C: 0, D: 0 };
    elBtnStart.disabled = true;
    elBtnStart.textContent = "答题中...";
    elHint.innerHTML = `答题进行中，观众发送 <b>A/B/C/D</b> 作答`;
    renderOptions();
    updateTimer();

    timerHandle = setInterval(() => {
      timeLeft--;
      updateTimer();
      if (timeLeft <= 0) endAnswer();
    }, 1000);
  }

  function endAnswer() {
    clearInterval(timerHandle);
    timerHandle = null;
    answering = false;
    timeLeft = 0;
    elBtnStart.disabled = false;
    elBtnStart.textContent = "开始答题";
    const q = questions[currentIdx];
    if (q) q._revealed = true;
    // 统计
    const total = answeredUsers.size;
    const right = [...answeredUsers.values()].filter((a) => a.correct).length;
    elHint.innerHTML = `答题结束 · 共 <b>${total}</b> 人参与，<b>${right}</b> 人答对`;
    renderOptions();
    renderStats();
  }

  function updateTimer() {
    elTimerNum.textContent = timeLeft;
    const r = 22;
    const c = 2 * Math.PI * r;
    const pct = timeLeft / COUNTDOWN_SECONDS;
    elTimerCircle.setAttribute("stroke-dasharray", c);
    elTimerCircle.setAttribute("stroke-dashoffset", c * (1 - pct));
    // 颜色变化
    if (timeLeft <= 3) elTimerCircle.setAttribute("stroke", "#ef4444");
    else if (timeLeft <= 7) elTimerCircle.setAttribute("stroke", "#f59e0b");
    else elTimerCircle.setAttribute("stroke", "#6366f1");
  }

  /* ---------- 排行榜 ---------- */
  function renderLeaderboard() {
    const list = Storage.leaderboardSorted().slice(0, 50);
    if (!list.length) {
      elLbList.innerHTML = `<div class="lb-empty">暂无排行，开始答题后观众作答即可上榜</div>`;
      return;
    }
    elLbList.innerHTML = list
      .map((it, i) => `
        <div class="lb-item">
          <div class="lb-rank">${i + 1}</div>
          <div class="lb-name">${escapeHtml(it.name)}</div>
          <div class="lb-score">${it.score}</div>
        </div>
      `)
      .join("");
  }

  function renderStats() {
    const q = questions[currentIdx];
    if (!q) { elStats.innerHTML = ""; return; }
    const total = answeredUsers.size;
    const right = [...answeredUsers.values()].filter((a) => a.correct).length;
    elStats.innerHTML = `本题参与 <b>${total}</b> · 答对 <b>${right}</b> · 正确答案 <b style="color:#22c55e">${q.answer || "-"}</b>`;
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    elBtnPrev.addEventListener("click", () => {
      if (currentIdx > 0) {
        if (questions[currentIdx]) questions[currentIdx]._revealed = false;
        currentIdx--;
        resetRoundUI();
        renderQuestion();
        renderStats();
      }
    });
    elBtnNext.addEventListener("click", () => {
      if (currentIdx < questions.length - 1) {
        if (questions[currentIdx]) questions[currentIdx]._revealed = false;
        currentIdx++;
        resetRoundUI();
        renderQuestion();
        renderStats();
      }
    });
    elBtnStart.addEventListener("click", startAnswer);
    elBtnReset.addEventListener("click", () => {
      if (confirm("确定重置排行榜吗？所有积分将清零。")) {
        Storage.resetLeaderboard();
        answeredUsers.clear();
        renderLeaderboard();
        renderStats();
        toast("排行榜已重置");
      }
    });
    // 设置入口
    $("#btn-settings").addEventListener("click", () => {
      location.href = "./settings.html";
    });
  }

  function resetRoundUI() {
    clearInterval(timerHandle);
    answering = false;
    timeLeft = 0;
    answeredUsers.clear();
    optionCounts = { A: 0, B: 0, C: 0, D: 0 };
    elBtnStart.disabled = false;
    elBtnStart.textContent = "开始答题";
    elHint.innerHTML = `点击 <b>开始答题</b>，观众在直播间发送 A/B/C/D 即可参与`;
    updateTimer();
  }

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return (s || "").toString()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

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
    toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
