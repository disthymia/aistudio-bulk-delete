(() => {
  "use strict";

  const SELECTORS = {
    // Chat turns
    chatTurn: "ms-chat-turn",
    chatTurnMenuButton: "ms-chat-turn-options button, ms-chat-turn-options [role='button']",

    // History / Library (table-based or div/row-based)
    historyTable: "ms-library-table table, ms-history-table table, table.mat-mdc-table, main table",
    historyHeadRow: "thead tr",
    historyBodyRows: "tbody tr",
    historyAriaRows: '[role="table"] [role="row"]:not(:first-child), [role="grid"] [role="row"]:not(:first-child)',

    // Material overlay menus & confirmation dialogs
    overlayMenuButtons:
      ".cdk-overlay-container [role='menu'] button, .cdk-overlay-container .mat-mdc-menu-content button, .cdk-overlay-container button[mat-menu-item]",
    overlayDialog:
      ".cdk-overlay-container mat-mdc-dialog-container, .cdk-overlay-container [role='dialog']",
  };

  let isDeleting = false;
  let shouldStop = false;
  let lastCheckedIndex = null;
  let lastUrl = location.href;

  // ---------- Utility Helpers ----------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function detectMode() {
    if (document.querySelector(SELECTORS.chatTurn)) return "chat";

    const path = location.pathname;
    if (/\/(history|library)(\/|$)/i.test(path)) return "history";
    if (document.querySelector(SELECTORS.historyTable) || document.querySelector(SELECTORS.historyAriaRows)) {
      return "history";
    }
    return null;
  }

  async function waitFor(fn, timeoutMs = 2500, intervalMs = 50) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = fn();
      if (result) return result;
      await sleep(intervalMs);
    }
    return null;
  }

  function findRowMenuTrigger(rowEl) {
    // Prefer a button whose icon or aria-label represents more_vert / options
    const buttons = Array.from(rowEl.querySelectorAll("button, [role='button']"));
    return (
      buttons.find((btn) => {
        const iconText = (btn.querySelector("mat-icon, .material-symbols-outlined")?.textContent || "").trim();
        const aria = btn.getAttribute("aria-label") || "";
        return (
          iconText === "more_vert" ||
          iconText === "more_horiz" ||
          /more|option|menu|action/i.test(aria)
        );
      }) ||
      buttons[buttons.length - 1] ||
      null
    );
  }

  function findMenuDeleteButton() {
    const buttons = Array.from(document.querySelectorAll(SELECTORS.overlayMenuButtons));
    return (
      buttons.find((btn) => {
        const iconText = (btn.querySelector("mat-icon, .material-symbols-outlined")?.textContent || "").trim();
        if (iconText === "delete" || iconText === "delete_outline" || iconText === "delete_forever") {
          return true;
        }
        const labelEl = btn.querySelector(".mat-mdc-menu-item-text, .mdc-list-item__primary-text");
        const text = (labelEl ? labelEl.textContent : btn.textContent || "").trim();
        return /\bdelete\b/i.test(text) && !/delete before/i.test(text);
      }) || null
    );
  }

  function findDialogConfirmButton(dialog) {
    const buttons = Array.from(dialog.querySelectorAll("button"));
    return (
      buttons.find((btn) => /^(delete|confirm|yes|remove)$/i.test((btn.textContent || "").trim())) ||
      buttons.find((btn) => btn.classList.contains("mat-warn")) ||
      null
    );
  }

  // ---------- Trusted-Types-Safe Toolbar ----------

  function createBtn(id, label, className, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = id;
    btn.textContent = label;
    btn.className = `ais-bd-btn ${className}`;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function ensureToolbar() {
    let toolbar = document.getElementById("ais-bd-toolbar");
    if (toolbar) return toolbar;

    toolbar = document.createElement("div");
    toolbar.id = "ais-bd-toolbar";

    const status = document.createElement("span");
    status.id = "ais-bd-status";
    status.textContent = "0 selected";

    const selectAllBtn = createBtn(
      "ais-bd-select-all",
      "Select All",
      "ais-bd-btn-secondary",
      () => toggleSelectAll(true)
    );
    const clearBtn = createBtn(
      "ais-bd-clear",
      "Clear",
      "ais-bd-btn-secondary",
      () => toggleSelectAll(false)
    );
    const deleteBtn = createBtn(
      "ais-bd-delete",
      "Delete Selected",
      "ais-bd-btn-danger",
      handleBulkDelete
    );
    const stopBtn = createBtn(
      "ais-bd-stop",
      "Stop",
      "ais-bd-btn-secondary",
      () => {
        shouldStop = true;
      }
    );
    stopBtn.style.display = "none";

    toolbar.append(status, selectAllBtn, clearBtn, deleteBtn, stopBtn);
    document.body.appendChild(toolbar);
    return toolbar;
  }

  function getCheckboxes() {
    return Array.from(document.querySelectorAll("input.ais-bd-item-checkbox"));
  }

  function getSelectedCheckboxes() {
    return getCheckboxes().filter((cb) => cb.checked);
  }

  function updateToolbarUI() {
    const mode = detectMode();
    const toolbar = ensureToolbar();
    const all = getCheckboxes();

    if (!mode || all.length === 0) {
      toolbar.classList.remove("ais-bd-visible");
      return;
    }

    const selected = all.filter((cb) => cb.checked);
    const statusEl = document.getElementById("ais-bd-status");
    const delBtn = document.getElementById("ais-bd-delete");
    const stopBtn = document.getElementById("ais-bd-stop");
    const selectAllBtn = document.getElementById("ais-bd-select-all");
    const clearBtn = document.getElementById("ais-bd-clear");

    const headerCb = document.getElementById("ais-bd-header-checkbox");
    if (headerCb) {
      headerCb.checked = selected.length === all.length;
      headerCb.indeterminate = selected.length > 0 && selected.length < all.length;
    }

    toolbar.classList.add("ais-bd-visible");

    if (isDeleting) {
      delBtn.disabled = true;
      selectAllBtn.disabled = true;
      clearBtn.disabled = true;
      stopBtn.style.display = "inline-block";
      return;
    }

    stopBtn.style.display = "none";
    selectAllBtn.disabled = false;
    clearBtn.disabled = selected.length === 0;
    delBtn.disabled = selected.length === 0;
    statusEl.textContent = `${selected.length} / ${all.length} selected`;
  }

  function toggleSelectAll(checked) {
    if (isDeleting) return;
    getCheckboxes().forEach((cb) => {
      cb.checked = checked;
      syncItemHighlight(cb);
    });
    updateToolbarUI();
  }

  function syncItemHighlight(cb) {
    const row = cb.closest("tr, [role='row'], .ais-bd-history-row");
    if (row) row.classList.toggle("ais-bd-row-selected", cb.checked);

    const turn = cb.closest(SELECTORS.chatTurn);
    if (turn) turn.classList.toggle("ais-bd-turn-selected", cb.checked);
  }

  function attachCheckboxBehavior(cb) {
    ["click", "mousedown", "pointerdown"].forEach((evt) => {
      cb.addEventListener(evt, (e) => e.stopPropagation());
    });

    cb.addEventListener("click", (e) => {
      window._aisBdLastShift = e.shiftKey;
      setTimeout(() => {
        window._aisBdLastShift = false;
      }, 0);
    });

    cb.addEventListener("change", (e) => {
      const all = getCheckboxes();
      const idx = all.indexOf(cb);

      if ((e.shiftKey || window._aisBdLastShift) && lastCheckedIndex !== null && idx !== -1) {
        const [start, end] = [Math.min(lastCheckedIndex, idx), Math.max(lastCheckedIndex, idx)];
        for (let i = start; i <= end; i++) {
          all[i].checked = cb.checked;
          syncItemHighlight(all[i]);
        }
      }

      if (idx !== -1) lastCheckedIndex = idx;
      syncItemHighlight(cb);
      updateToolbarUI();
    });
  }

  // ---------- Chat Turn Injection ----------

  function injectChatTurnCheckboxes() {
    const turns = Array.from(document.querySelectorAll(SELECTORS.chatTurn));
    turns.forEach((turn) => {
      if (turn.querySelector(".ais-bd-turn-check-wrap")) return;

      turn.classList.add("ais-bd-turn-wrapper");
      const wrap = document.createElement("div");
      wrap.className = "ais-bd-turn-check-wrap";
      ["click", "mousedown", "pointerdown"].forEach((evt) =>
        wrap.addEventListener(evt, (e) => e.stopPropagation())
      );

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "ais-bd-checkbox ais-bd-item-checkbox";
      cb.title = "Select this message turn (Shift+Click for range)";

      attachCheckboxBehavior(cb);
      wrap.appendChild(cb);
      turn.appendChild(wrap);
    });
  }

  // ---------- History / Library Injection ----------

  function findNonTableHistoryRows() {
    // 1. ARIA table/grid rows
    const ariaRows = Array.from(document.querySelectorAll(SELECTORS.historyAriaRows));
    if (ariaRows.length > 0) return ariaRows;

    // 2. Fallback: find container rows that hold a "more_vert" button inside main content
    const main = document.querySelector("main") || document.body;
    const moreButtons = Array.from(main.querySelectorAll("button")).filter((btn) => {
      const iconText = (btn.querySelector("mat-icon, .material-symbols-outlined")?.textContent || "").trim();
      return iconText === "more_vert";
    });

    const rows = [];
    for (const btn of moreButtons) {
      // Walk up a few levels to find the full horizontal row element
      let el = btn.parentElement;
      for (let i = 0; i < 5 && el && el !== main; i++) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 400 && rect.height >= 36 && rect.height <= 120) {
          el.classList.add("ais-bd-history-row");
          rows.push(el);
          break;
        }
        el = el.parentElement;
      }
    }
    return Array.from(new Set(rows));
  }

  function injectHistoryCheckboxes() {
    const table = document.querySelector(SELECTORS.historyTable);
    if (table) {
      const headRow = table.querySelector(SELECTORS.historyHeadRow);
      if (headRow && !headRow.querySelector(".ais-bd-th")) {
        const th = document.createElement("th");
        th.className = "ais-bd-th mat-mdc-header-cell mdc-data-table__header-cell";
        const headerCb = document.createElement("input");
        headerCb.type = "checkbox";
        headerCb.id = "ais-bd-header-checkbox";
        headerCb.className = "ais-bd-checkbox";
        headerCb.title = "Select all";

        ["click", "mousedown", "pointerdown"].forEach((evt) =>
          headerCb.addEventListener(evt, (e) => e.stopPropagation())
        );
        headerCb.addEventListener("change", () => toggleSelectAll(headerCb.checked));

        th.appendChild(headerCb);
        headRow.insertBefore(th, headRow.firstChild);
      }

      const rows = Array.from(table.querySelectorAll(SELECTORS.historyBodyRows));
      rows.forEach((row) => {
        if (row.querySelector(".ais-bd-td")) return;

        const td = document.createElement("td");
        td.className = "ais-bd-td mat-mdc-cell mdc-data-table__cell";
        ["click", "mousedown", "pointerdown"].forEach((evt) =>
          td.addEventListener(evt, (e) => e.stopPropagation())
        );

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "ais-bd-checkbox ais-bd-item-checkbox";
        cb.setAttribute("aria-label", "Select prompt");

        attachCheckboxBehavior(cb);
        td.appendChild(cb);
        row.insertBefore(td, row.firstChild);
      });
      return;
    }

    // Non-table fallback for newer History layouts
    const rows = findNonTableHistoryRows();
    rows.forEach((row) => {
      if (row.querySelector(".ais-bd-history-inline-wrap")) return;

      const wrap = document.createElement("div");
      wrap.className = "ais-bd-history-inline-wrap";
      ["click", "mousedown", "pointerdown"].forEach((evt) =>
        wrap.addEventListener(evt, (e) => e.stopPropagation())
      );

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "ais-bd-checkbox ais-bd-item-checkbox";
      cb.setAttribute("aria-label", "Select prompt");

      attachCheckboxBehavior(cb);
      wrap.appendChild(cb);
      row.insertBefore(wrap, row.firstChild);
    });
  }

  // ---------- Sequential Deletion Engine ----------

  async function deleteSingleTarget(targetEl, mode) {
    if (!document.contains(targetEl)) return false;

    targetEl.scrollIntoView({ block: "center", behavior: "instant" });

    // Dispatch hover in case turn options render/enable on mouseenter
    targetEl.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    targetEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await sleep(60);

    const menuTrigger =
      mode === "chat"
        ? await waitFor(() => targetEl.querySelector(SELECTORS.chatTurnMenuButton), 800)
        : findRowMenuTrigger(targetEl);

    if (!menuTrigger) {
      console.warn("[AI Studio Bulk Delete] Menu button not found for item:", targetEl);
      return false;
    }

    menuTrigger.click();

    const deleteMenuItem = await waitFor(findMenuDeleteButton, 2000);
    if (!deleteMenuItem) {
      document.body.click();
      console.warn("[AI Studio Bulk Delete] Delete menu item not found.");
      return false;
    }

    deleteMenuItem.click();

    // Wait briefly to see if a confirmation modal pops up
    const dialog = await waitFor(() => document.querySelector(SELECTORS.overlayDialog), 900);
    if (dialog) {
      const confirmBtn = await waitFor(() => findDialogConfirmButton(dialog), 1200);
      if (confirmBtn) confirmBtn.click();
      await waitFor(() => !document.querySelector(SELECTORS.overlayDialog), 4000);
    }

    await waitFor(() => !document.contains(targetEl), 3000);
    await sleep(200);
    return true;
  }

  async function handleBulkDelete() {
    if (isDeleting) return;
    const mode = detectMode();
    if (!mode) return;

    const selectedCbs = getSelectedCheckboxes();
    if (selectedCbs.length === 0) return;

    const itemLabel = mode === "chat" ? "chat turn(s)" : "saved prompt(s)";
    const confirmed = window.confirm(
      `Permanently delete ${selectedCbs.length} selected ${itemLabel}?`
    );
    if (!confirmed) return;

    const targetSelector =
      mode === "chat" ? SELECTORS.chatTurn : "tr, [role='row'], .ais-bd-history-row";
    const targets = selectedCbs.map((cb) => cb.closest(targetSelector)).filter(Boolean);

    isDeleting = true;
    shouldStop = false;
    updateToolbarUI();

    const statusEl = document.getElementById("ais-bd-status");

    for (let i = 0; i < targets.length; i++) {
      if (shouldStop) break;
      statusEl.textContent = `Deleting ${i + 1} / ${targets.length}...`;

      try {
        await deleteSingleTarget(targets[i], mode);
      } catch (err) {
        console.error("[AI Studio Bulk Delete] Error deleting item:", err);
      }
    }

    isDeleting = false;
    shouldStop = false;
    lastCheckedIndex = null;
    updateToolbarUI();
  }

  // ---------- SPA & DOM Observer ----------

  function runInjection() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastCheckedIndex = null;
    }

    const mode = detectMode();
    if (mode === "chat") {
      injectChatTurnCheckboxes();
    } else if (mode === "history") {
      injectHistoryCheckboxes();
    }
    updateToolbarUI();
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runInjection, 200);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", runInjection);
  runInjection();
  console.log("[AI Studio Bulk Delete] Extension initialized.");
})();