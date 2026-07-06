/**
 * app.js - 主答题页面逻辑
 * 负责：题目展示、ABCD 选项、倒计时、弹幕答案监听、排行榜计分
 */
(function () {
  "use strict";

  const CORRECT_SCORE = 10;     // 答对基础分
  const AUTO_NEXT_DELAY = 3000; // 自动模式下倒计时结束后等待时长

  // 题库与配置
  let questions = [];
  let currentIdx = 0;
  let config = {};
  let countdownSec = 15;        // 倒计时秒数（从配置读取）

  // 答题状态
  let answering = false;        // 是否正在答题（倒计时中）
  let timeLeft = 0;
  let timerHandle = null;
  let autoNextTimer = null;     // 自动答题模式下，倒计时结束后切换下一题的定时器
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

  /* ---------- 初始化 ---------- */
  function init() {
    config = Storage.getConfig();
    countdownSec = config.countdown || 15;

    // 应用主题
    Storage.applyTheme(config.theme || "purple");

    // 构建答题列表（科目过滤 / 全部随机）
    questions = buildPlayList();
    currentIdx = config.subjectMode ? (Storage.getCurrentIndex() || 0) : 0;

    // 直播间名称
    elRoomName.textContent = config.roomName || "未配置直播间";

    // 模式提示
    const modeTip = config.answerMode === "auto" ? "自动答题" : "手动答题";
    const subjTip = config.subjectMode
      ? `· 科目：${config.subjectFilter || "未选"}`
      : "· 随机答题";
    elHint.innerHTML = `<b>${modeTip}</b> ${subjTip} · 点击开始答题`;
    elTimerNum.textContent = countdownSec;

    // 注册 Service Worker (PWA)
    if ("serviceWorker" in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register("./sw.js").then((reg) => {
        reg.update();
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          // 仅在更新场景（之前已有 controller）刷新一次，避免首次注册循环
          if (hadController && !sessionStorage.getItem("sw_reloaded")) {
            sessionStorage.setItem("sw_reloaded", "1");
            location.reload();
          }
        });
      }).catch((e) => console.warn("SW 注册失败:", e));
    }

    renderQuestion();
    renderLeaderboard();
    bindEvents();
    connectLive();
  }

  /* ---------- 构建答题列表 ---------- */
  function buildPlayList() {
    let list = Storage.getQuestions();
    if (config.subjectMode && config.subjectFilter) {
      list = list.filter((q) => q.subject === config.subjectFilter);
    } else if (!config.subjectMode) {
      // 关闭科目答题 → 全部题目随机打乱
      list = shuffle([...list]);
    }
    return list;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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
        const bonus = Math.round((timeLeft / countdownSec) * CORRECT_SCORE);
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
    clearTimeout(autoNextTimer); // 用户手动开始答题，取消待执行的自动切换
    const q = questions[currentIdx];
    if (!q) { toast("没有题目"); return; }
    if (!q.answer) { toast("本题未设置正确答案"); return; }

    answering = true;
    timeLeft = countdownSec;
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

    // 显示答案揭晓全屏动画
    showRevealOverlay(q);

    // 自动答题模式：倒计时结束后自动进入下一题并开始答题（循环）
    if (config.answerMode === "auto" && currentIdx < questions.length - 1) {
      elHint.innerHTML += ` · <b>${AUTO_NEXT_DELAY / 1000}</b> 秒后自动开始下一题`;
      autoNextTimer = setTimeout(() => {
        if (!answering) {
          goNext();
          // 下一题就绪后立即开始倒计时，形成自动答题循环
          if (questions[currentIdx] && questions[currentIdx].answer) {
            startAnswer();
          } else {
            toast("下一题未设置正确答案，已暂停自动答题");
          }
        }
      }, AUTO_NEXT_DELAY);
    } else if (config.answerMode === "auto" && currentIdx >= questions.length - 1) {
      elHint.innerHTML += ` · 已是最后一题，自动答题结束`;
    }
  }

  /* ---------- 答案揭晓全屏遮罩 ---------- */
  function showRevealOverlay(q) {
    if (!q || !q.answer) return;
    
    const overlay = document.createElement("div");
    overlay.className = "reveal-overlay";
    overlay.innerHTML = `
      <div class="reveal-content">
        <div class="reveal-question">${escapeHtml(q.question)}</div>
        <div class="reveal-answer">正确答案：${q.answer}</div>
      </div>
      <div class="reveal-countdown">3 秒后继续...</div>
    `;
    document.body.appendChild(overlay);

    let countdown = 3;
    const countdownEl = overlay.querySelector(".reveal-countdown");
    const countdownInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        countdownEl.textContent = countdown + " 秒后继续...";
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(countdownInterval);
      overlay.style.animation = "fadeIn 0.2s ease-out reverse";
      setTimeout(() => {
        overlay.remove();
      }, 200);
    }, 3000);
  }

  function updateTimer() {
    elTimerNum.textContent = timeLeft;
    const r = 22;
    const c = 2 * Math.PI * r;
    const pct = countdownSec > 0 ? timeLeft / countdownSec : 0;
    elTimerCircle.setAttribute("stroke-dasharray", c);
    elTimerCircle.setAttribute("stroke-dashoffset", c * (1 - pct));
    // 颜色变化
    if (timeLeft <= 3) elTimerCircle.setAttribute("stroke", "#ef4444");
    else if (timeLeft <= Math.ceil(countdownSec / 2)) elTimerCircle.setAttribute("stroke", "#f59e0b");
    else elTimerCircle.setAttribute("stroke", primaryColor());
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
    const revealed = q._revealed;
    if (!revealed) {
      elStats.innerHTML = `<b>等待开始答题</b>`;
      return;
    }
    const total = answeredUsers.size;
    const right = [...answeredUsers.values()].filter((a) => a.correct).length;
    elStats.innerHTML = `本题参与 <b>${total}</b> · 答对 <b>${right}</b> · 正确答案 <b style="color:#22c55e">${q.answer || "-"}</b>`;
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    elBtnPrev.addEventListener("click", goPrev);
    elBtnNext.addEventListener("click", goNext);
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

  function goPrev() {
    if (currentIdx > 0) {
      if (questions[currentIdx]) questions[currentIdx]._revealed = false;
      currentIdx--;
      if (questions[currentIdx]) questions[currentIdx]._revealed = false;
      resetRoundUI();
      renderQuestion();
      renderStats();
    }
  }

  function goNext() {
    if (currentIdx < questions.length - 1) {
      if (questions[currentIdx]) questions[currentIdx]._revealed = false;
      currentIdx++;
      if (questions[currentIdx]) questions[currentIdx]._revealed = false;
      resetRoundUI();
      renderQuestion();
      renderStats();
    } else {
      toast("已是最后一题");
    }
  }

  function resetRoundUI() {
    clearInterval(timerHandle);
    clearTimeout(autoNextTimer); // 切换题目时取消待执行的自动切换
    answering = false;
    timeLeft = 0;
    answeredUsers.clear();
    optionCounts = { A: 0, B: 0, C: 0, D: 0 };
    elBtnStart.disabled = false;
    elBtnStart.textContent = "开始答题";
    elHint.innerHTML = `点击 <b>开始答题</b>，观众在直播间发送 A/B/C/D 即可参与`;
    updateTimer();
    elTimerNum.textContent = countdownSec;
  }

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return (s || "").toString()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function primaryColor() {
    return getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#6366f1";
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
