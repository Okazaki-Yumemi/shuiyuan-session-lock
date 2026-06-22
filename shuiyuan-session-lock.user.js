// ==UserScript==
// @name         Shuiyuan Session Lock
// @namespace    https://shuiyuan.sjtu.edu.cn/
// @version      2.3.0
// @description  Choose how long to block Shuiyuan except academic-study, with closable prompt, undo window and daily force-exit quota.
// @match        https://shuiyuan.sjtu.edu.cn/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  /***********************
   * 配置区
   ***********************/

  const ENABLED = true;

  const STUDY_URL = "https://shuiyuan.sjtu.edu.cn/c/sjtu-study/academic-study";
  const ALLOWED_PREFIX = "/c/sjtu-study/academic-study";

  const STORAGE_KEY_LOCK_UNTIL = "shuiyuan_session_lock_until";
  const STORAGE_KEY_FORCE_EXIT_RECORD = "shuiyuan_force_exit_record";
  const STORAGE_KEY_UNDO_UNTIL = "shuiyuan_session_undo_until";

  // 当前标签页内使用。强制取消、撤销、关闭弹窗后，不要立刻再次弹出选择时长窗口。
  const SESSION_KEY_SUPPRESS_PROMPT = "shuiyuan_suppress_prompt_after_exit_or_undo";

  const MAX_FORCE_EXITS_PER_DAY = 5;

  // 选择“不看水源”后的反悔窗口。
  // 30 秒内撤销不消耗强制取消次数。
  const UNDO_WINDOW_MS = 30 * 1000;

  const DURATION_OPTIONS = [
    { label: "15 分钟", minutes: 15 },
    { label: "30 分钟", minutes: 30 },
    { label: "1 小时", minutes: 60 },
    { label: "2 小时", minutes: 120 },
    { label: "4 小时", minutes: 240 },
    { label: "8 小时", minutes: 480 },
    { label: "12 小时", minutes: 720 }
  ];

  let promptRenderScheduled = false;

  /***********************
   * 基础工具
   ***********************/

  function nowMs() {
    return Date.now();
  }

  function localDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getLockUntil() {
    const value = Number(GM_getValue(STORAGE_KEY_LOCK_UNTIL, 0));
    return Number.isFinite(value) ? value : 0;
  }

  function setLockUntil(timestamp) {
    GM_setValue(STORAGE_KEY_LOCK_UNTIL, timestamp);
  }

  function clearLockUntil() {
    GM_deleteValue(STORAGE_KEY_LOCK_UNTIL);
  }

  function getUndoUntil() {
    const value = Number(GM_getValue(STORAGE_KEY_UNDO_UNTIL, 0));
    return Number.isFinite(value) ? value : 0;
  }

  function setUndoUntil(timestamp) {
    GM_setValue(STORAGE_KEY_UNDO_UNTIL, timestamp);
  }

  function clearUndoUntil() {
    GM_deleteValue(STORAGE_KEY_UNDO_UNTIL);
  }

  function isUndoAvailable() {
    const undoUntil = getUndoUntil();

    if (!undoUntil) return false;

    if (undoUntil <= nowMs()) {
      clearUndoUntil();
      return false;
    }

    if (!getLockUntil()) {
      clearUndoUntil();
      return false;
    }

    return true;
  }

  function formatUndoRemaining() {
    const seconds = Math.max(1, Math.ceil((getUndoUntil() - nowMs()) / 1000));
    return `${seconds} 秒`;
  }

  function getForceExitRecord() {
    const today = localDateString();
    const raw = GM_getValue(STORAGE_KEY_FORCE_EXIT_RECORD, "");

    try {
      const record = JSON.parse(raw);

      if (!record || record.date !== today) {
        return { date: today, used: 0 };
      }

      const used = Number(record.used);

      return {
        date: today,
        used: Number.isFinite(used) && used >= 0 ? used : 0
      };
    } catch {
      return { date: today, used: 0 };
    }
  }

  function setForceExitRecord(record) {
    GM_setValue(STORAGE_KEY_FORCE_EXIT_RECORD, JSON.stringify(record));
  }

  function getRemainingForceExits() {
    const record = getForceExitRecord();
    return Math.max(0, MAX_FORCE_EXITS_PER_DAY - record.used);
  }

  function consumeForceExitChance() {
    const record = getForceExitRecord();

    if (record.used >= MAX_FORCE_EXITS_PER_DAY) {
      return false;
    }

    record.used += 1;
    setForceExitRecord(record);
    return true;
  }

  function isLockActive() {
    if (!ENABLED) return false;

    const until = getLockUntil();

    if (!until) return false;

    if (until <= nowMs()) {
      clearLockUntil();
      clearUndoUntil();
      return false;
    }

    return true;
  }

  function normalizePath(path) {
    return path.replace(/\/+$/, "") || "/";
  }

  function isAllowedPage() {
    const path = normalizePath(location.pathname);
    return path === ALLOWED_PREFIX || path.startsWith(ALLOWED_PREFIX + "/");
  }

  function formatRemaining(ms) {
    const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (h === 0) return `${m} 分钟`;
    if (m === 0) return `${h} 小时`;
    return `${h} 小时 ${m} 分钟`;
  }

  function shouldSuppressPromptInThisTab() {
    return sessionStorage.getItem(SESSION_KEY_SUPPRESS_PROMPT) === "1";
  }

  function suppressPromptInThisTab() {
    sessionStorage.setItem(SESSION_KEY_SUPPRESS_PROMPT, "1");
  }

  function allowPromptInThisTab() {
    sessionStorage.removeItem(SESSION_KEY_SUPPRESS_PROMPT);
  }

  function startNewLock(minutes) {
    const until = nowMs() + minutes * 60 * 1000;
    const undoUntil = nowMs() + UNDO_WINDOW_MS;

    allowPromptInThisTab();
    setLockUntil(until);
    setUndoUntil(undoUntil);
  }

  /***********************
   * 通用样式
   ***********************/

  function injectStyle() {
    if (document.getElementById("sy-session-lock-style")) return;

    const style = document.createElement("style");
    style.id = "sy-session-lock-style";
    style.textContent = `
      #sy-session-lock-overlay,
      #sy-session-status-panel,
      #sy-session-idle-panel {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }

      #sy-session-lock-overlay {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: rgba(15, 23, 42, 0.92) !important;
        color: #e5e7eb !important;
      }

      #sy-session-lock-overlay .sy-box {
        position: relative !important;
        width: min(560px, calc(100vw - 48px)) !important;
        padding: 28px !important;
        border-radius: 18px !important;
        background: #111827 !important;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45) !important;
      }

      #sy-session-lock-overlay .sy-close {
        position: absolute !important;
        top: 14px !important;
        right: 14px !important;
        width: 36px !important;
        height: 36px !important;
        padding: 0 !important;
        border-radius: 999px !important;
        background: #374151 !important;
        color: #e5e7eb !important;
        font-size: 22px !important;
        line-height: 36px !important;
      }

      #sy-session-lock-overlay h1 {
        margin: 0 0 10px !important;
        font-size: 24px !important;
        line-height: 1.35 !important;
      }

      #sy-session-lock-overlay p {
        margin: 8px 0 !important;
        color: #cbd5e1 !important;
        font-size: 15px !important;
        line-height: 1.7 !important;
      }

      #sy-session-lock-overlay .sy-grid {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        gap: 10px !important;
        margin-top: 20px !important;
      }

      #sy-session-lock-overlay button,
      #sy-session-status-panel button,
      #sy-session-idle-panel button {
        border: 0 !important;
        border-radius: 10px !important;
        padding: 10px 12px !important;
        cursor: pointer !important;
        font-size: 14px !important;
        font-weight: 650 !important;
        background: #2563eb !important;
        color: white !important;
      }

      #sy-session-lock-overlay button:hover,
      #sy-session-status-panel button:hover,
      #sy-session-idle-panel button:hover {
        filter: brightness(1.08) !important;
      }

      #sy-session-lock-overlay .sy-secondary {
        margin-top: 12px !important;
        width: 100% !important;
        background: #374151 !important;
      }

      #sy-session-lock-overlay .sy-note {
        margin-top: 16px !important;
        color: #94a3b8 !important;
        font-size: 13px !important;
      }

      #sy-session-lock-overlay code {
        background: #1f2937 !important;
        padding: 2px 5px !important;
        border-radius: 5px !important;
      }

      #sy-session-status-panel,
      #sy-session-idle-panel {
        position: fixed !important;
        right: 18px !important;
        bottom: 18px !important;
        z-index: 2147483646 !important;
        width: 280px !important;
        padding: 14px !important;
        border-radius: 14px !important;
        background: #111827 !important;
        color: #e5e7eb !important;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35) !important;
      }

      #sy-session-status-panel .sy-title,
      #sy-session-idle-panel .sy-title {
        font-size: 15px !important;
        font-weight: 750 !important;
        margin-bottom: 8px !important;
      }

      #sy-session-status-panel .sy-line,
      #sy-session-idle-panel .sy-line {
        font-size: 13px !important;
        color: #cbd5e1 !important;
        line-height: 1.6 !important;
      }

      #sy-session-status-panel button,
      #sy-session-idle-panel button {
        margin-top: 10px !important;
        width: 100% !important;
      }

      #sy-session-status-panel .sy-danger {
        background: #dc2626 !important;
      }

      #sy-session-status-panel .sy-undo {
        background: #475569 !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function removeElement(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  /***********************
   * 撤销刚刚选择
   ***********************/

  function undoRecentLockFlow(source) {
    if (!isUndoAvailable()) {
      alert("撤销窗口已经过期。现在如果要退出，需要使用“强制取消专注”。");
      guard();
      return;
    }

    const ok = confirm(
      [
        "撤销刚刚的“不看水源”选择？",
        "",
        "这不会消耗今日强制取消专注次数。"
      ].join("\n")
    );

    if (!ok) return;

    clearLockUntil();
    clearUndoUntil();
    suppressPromptInThisTab();

    alert("已撤销刚刚的选择。当前标签页不会立刻重新弹出锁定选择。");

    if (source === "locked-page") {
      location.reload();
      return;
    }

    removeElement("sy-session-status-panel");
    removeElement("sy-session-lock-overlay");
    renderIdlePanel();
  }

  /***********************
   * 强制取消流程
   ***********************/

  function forceExitFlow(source) {
    const remaining = getRemainingForceExits();

    if (remaining <= 0) {
      alert("今天的 5 次强制取消专注机会已经用完。");
      return;
    }

    const ok = confirm(
      [
        "确认强制取消当前专注锁定？",
        "",
        "这会消耗 1 次今日强制取消机会。",
        `当前剩余：${remaining} / ${MAX_FORCE_EXITS_PER_DAY} 次。`
      ].join("\n")
    );

    if (!ok) return;

    const consumed = consumeForceExitChance();

    if (!consumed) {
      alert("今天的 5 次强制取消专注机会已经用完。");
      return;
    }

    clearLockUntil();
    clearUndoUntil();
    suppressPromptInThisTab();

    const left = getRemainingForceExits();

    alert(`已取消当前专注锁定。今天剩余强制取消机会：${left} / ${MAX_FORCE_EXITS_PER_DAY} 次。`);

    if (source === "locked-page") {
      location.reload();
      return;
    }

    removeElement("sy-session-status-panel");
    renderIdlePanel();
  }

  /***********************
   * 选择锁定时长弹窗
   ***********************/

  function showChooseDurationPrompt() {
    if (document.getElementById("sy-session-lock-overlay")) return;

    const render = () => {
      promptRenderScheduled = false;
      injectStyle();

      if (document.getElementById("sy-session-lock-overlay")) return;

      const overlay = document.createElement("div");
      overlay.id = "sy-session-lock-overlay";

      const buttons = DURATION_OPTIONS.map((option) => {
        return `<button data-minutes="${option.minutes}">${option.label}</button>`;
      }).join("");

      overlay.innerHTML = `
        <div class="sy-box">
          <button
            class="sy-close"
            type="button"
            data-close-prompt="1"
            title="关闭弹窗"
            aria-label="关闭弹窗"
          >×</button>

          <h1>这次不看水源多久？</h1>
          <p>选择后，在倒计时结束前，水源社区除课业学习板块外都会被锁定。</p>
          <p>允许访问：<code>${STUDY_URL}</code></p>

          <div class="sy-grid">
            ${buttons}
          </div>

          <button class="sy-secondary" data-minutes="custom">自定义分钟数</button>
          <button class="sy-secondary" data-close-prompt="1">暂时不锁定，关闭弹窗</button>

          <p class="sy-note">
            选择后 ${Math.floor(UNDO_WINDOW_MS / 1000)} 秒内可以撤销，不消耗强制取消次数。
            <br>
            关闭弹窗不会消耗强制取消次数。
            <br>
            今日强制取消专注机会：${getRemainingForceExits()} / ${MAX_FORCE_EXITS_PER_DAY} 次。
          </p>
        </div>
      `;

      document.body.appendChild(overlay);

      overlay.addEventListener("click", (event) => {
        const target = event.target;
        if (!target || target.nodeType !== 1) return;

        const closeButton = target.closest("[data-close-prompt]");
        if (closeButton) {
          overlay.remove();
          suppressPromptInThisTab();
          renderIdlePanel();
          return;
        }

        const button = target.closest("button[data-minutes]");
        if (!button) return;

        const minutesValue = button.getAttribute("data-minutes");
        if (!minutesValue) return;

        let minutes;

        if (minutesValue === "custom") {
          const input = prompt("请输入锁定分钟数，例如 90：", "90");
          if (input === null) return;

          minutes = Number(input);

          if (!Number.isFinite(minutes) || minutes <= 0) {
            alert("输入无效。请输入正数分钟。");
            return;
          }
        } else {
          minutes = Number(minutesValue);
        }

        startNewLock(minutes);

        overlay.remove();
        guard();
      });
    };

    if (document.body) {
      render();
    } else if (!promptRenderScheduled) {
      promptRenderScheduled = true;
      document.addEventListener("DOMContentLoaded", render, { once: true });
    }
  }

  /***********************
   * 锁定页
   ***********************/

  function showLockedPage() {
    const until = getLockUntil();
    const remainingTime = formatRemaining(until - nowMs());
    const remainingForceExits = getRemainingForceExits();
    const undoAvailable = isUndoAvailable();
    const undoRemaining = undoAvailable ? formatUndoRemaining() : "";

    const existingPage = document.getElementById("sy-locked-page");

    if (existingPage) {
      const timeEl = document.getElementById("sy-locked-remaining-time");
      const quotaEl = document.getElementById("sy-locked-force-quota");
      const undoWrap = document.getElementById("sy-locked-undo-wrap");
      const undoTimeEl = document.getElementById("sy-locked-undo-time");

      if (timeEl) timeEl.textContent = remainingTime;
      if (quotaEl) quotaEl.textContent = `${remainingForceExits} / ${MAX_FORCE_EXITS_PER_DAY}`;

      if (undoWrap) {
        undoWrap.style.display = undoAvailable ? "" : "none";
      }

      if (undoTimeEl) {
        undoTimeEl.textContent = undoRemaining;
      }

      attachLockedPageHandlers();
      return;
    }

    document.documentElement.innerHTML = `
      <head>
        <title>水源已锁定</title>
        <style>
          html, body {
            margin: 0;
            height: 100%;
            background: #0f172a;
            color: #e5e7eb;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }

          body {
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .box {
            width: min(620px, calc(100vw - 48px));
            padding: 32px;
            border-radius: 18px;
            background: #111827;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
          }

          h1 {
            margin: 0 0 12px;
            font-size: 24px;
          }

          p {
            line-height: 1.7;
            color: #cbd5e1;
          }

          a, button {
            display: inline-block;
            margin-top: 18px;
            padding: 10px 14px;
            border-radius: 10px;
            color: white;
            text-decoration: none;
            font-weight: 650;
            font-size: 14px;
            border: 0;
            cursor: pointer;
          }

          a {
            background: #2563eb;
          }

          button {
            margin-left: 8px;
            background: #dc2626;
          }

          button.undo {
            margin-left: 0;
            margin-right: 8px;
            background: #475569;
          }

          code {
            background: #1f2937;
            padding: 2px 5px;
            border-radius: 5px;
          }

          .small {
            font-size: 13px;
            color: #94a3b8;
          }

          .undo-box {
            margin-top: 14px;
            padding: 12px 14px;
            border-radius: 12px;
            background: #1f2937;
          }

          .undo-box p {
            margin: 0 0 8px;
          }
        </style>
      </head>
      <body>
        <div class="box" id="sy-locked-page">
          <h1>水源已锁定</h1>
          <p>剩余锁定时间：<strong id="sy-locked-remaining-time">${remainingTime}</strong></p>
          <p>当前页面不在允许访问范围内。</p>
          <p>允许访问：</p>
          <p><code>${STUDY_URL}</code></p>

          <div class="undo-box" id="sy-locked-undo-wrap" style="${undoAvailable ? "" : "display: none;"}">
            <p class="small">刚刚开启专注。你还有 <strong id="sy-locked-undo-time">${undoRemaining}</strong> 可以撤销本次选择。</p>
            <button class="undo" id="sy-undo-from-locked-page">撤销刚刚的选择</button>
          </div>

          <p class="small">今日强制取消专注机会：<strong id="sy-locked-force-quota">${remainingForceExits} / ${MAX_FORCE_EXITS_PER_DAY}</strong></p>

          <a href="${STUDY_URL}">前往课业学习区</a>
          <button id="sy-force-exit-from-locked-page">强制取消专注</button>
        </div>
      </body>
    `;

    attachLockedPageHandlers();
  }

  function attachLockedPageHandlers() {
    const forceBtn = document.getElementById("sy-force-exit-from-locked-page");
    if (forceBtn) {
      forceBtn.onclick = () => {
        forceExitFlow("locked-page");
      };
    }

    const undoBtn = document.getElementById("sy-undo-from-locked-page");
    if (undoBtn) {
      undoBtn.onclick = () => {
        undoRecentLockFlow("locked-page");
      };
    }
  }

  /***********************
   * 课业学习区右下角状态面板
   ***********************/

  function renderStatusPanel() {
    if (!document.body) return;

    injectStyle();
    removeElement("sy-session-idle-panel");

    const until = getLockUntil();
    const remainingTime = formatRemaining(until - nowMs());
    const remainingForceExits = getRemainingForceExits();

    const undoAvailable = isUndoAvailable();
    const undoHtml = undoAvailable
      ? `
        <div class="sy-line">可撤销时间：<strong>${formatUndoRemaining()}</strong></div>
        <button class="sy-undo" id="sy-undo-from-panel">撤销刚刚的选择</button>
      `
      : "";

    let panel = document.getElementById("sy-session-status-panel");

    if (!panel) {
      panel = document.createElement("div");
      panel.id = "sy-session-status-panel";
      document.body.appendChild(panel);
    }

    panel.innerHTML = `
      <div class="sy-title">水源专注锁定中</div>
      <div class="sy-line">剩余时间：<strong>${remainingTime}</strong></div>
      <div class="sy-line">今日强制取消：<strong>${remainingForceExits} / ${MAX_FORCE_EXITS_PER_DAY}</strong></div>
      ${undoHtml}
      <button class="sy-danger" id="sy-force-exit-from-panel">强制取消专注</button>
    `;

    const forceBtn = document.getElementById("sy-force-exit-from-panel");
    if (forceBtn) {
      forceBtn.onclick = () => {
        forceExitFlow("status-panel");
      };
    }

    const undoBtn = document.getElementById("sy-undo-from-panel");
    if (undoBtn) {
      undoBtn.onclick = () => {
        undoRecentLockFlow("status-panel");
      };
    }
  }

  function renderIdlePanel() {
    if (!document.body) return;
    if (!shouldSuppressPromptInThisTab()) return;

    injectStyle();
    removeElement("sy-session-status-panel");

    let panel = document.getElementById("sy-session-idle-panel");

    if (!panel) {
      panel = document.createElement("div");
      panel.id = "sy-session-idle-panel";
      document.body.appendChild(panel);
    }

    panel.innerHTML = `
      <div class="sy-title">水源当前未锁定</div>
      <div class="sy-line">你刚刚关闭了选择弹窗，或取消/撤销过专注；当前标签页不会自动重新弹出锁定选择。</div>
      <div class="sy-line">今日强制取消剩余：<strong>${getRemainingForceExits()} / ${MAX_FORCE_EXITS_PER_DAY}</strong></div>
      <button id="sy-start-new-lock">开始新的“不看水源”</button>
    `;

    const btn = document.getElementById("sy-start-new-lock");
    if (btn) {
      btn.onclick = () => {
        allowPromptInThisTab();
        removeElement("sy-session-idle-panel");
        showChooseDurationPrompt();
      };
    }
  }

  /***********************
   * 主守卫逻辑
   ***********************/

  function guard() {
    if (!ENABLED) return;

    if (isLockActive()) {
      removeElement("sy-session-lock-overlay");

      if (isAllowedPage()) {
        renderStatusPanel();
      } else {
        showLockedPage();
      }

      return;
    }

    removeElement("sy-session-status-panel");

    if (shouldSuppressPromptInThisTab()) {
      renderIdlePanel();
      return;
    }

    showChooseDurationPrompt();
  }

  function patchHistory() {
    const rawPushState = history.pushState;
    const rawReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const ret = rawPushState.apply(this, args);
      setTimeout(guard, 0);
      return ret;
    };

    history.replaceState = function (...args) {
      const ret = rawReplaceState.apply(this, args);
      setTimeout(guard, 0);
      return ret;
    };

    window.addEventListener("popstate", guard);
  }

  patchHistory();

  guard();

  document.addEventListener("DOMContentLoaded", guard);
  setInterval(guard, 1000);
})();