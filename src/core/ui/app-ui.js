// Framework-free UI runtime shared by every renderer window.
//
// Loaded as the first script so it works even when React or a JSX file fails:
// - boot splash lifecycle and a recoverable "failed to start" screen
// - global error capture (logged to the main process, surfaced as toasts)
// - motion preference (<html data-motion="auto|full|reduced|off">)
// - ripple + press feedback for every clickable control
// - toast notifications and promise-based confirm/alert dialogs
// - an Escape-key stack so only the top-most layer closes
(function () {
  "use strict";

  if (window.AppUI) {
    return;
  }

  var doc = document;
  var root = doc.documentElement;

  // ---------------------------------------------------------------- helpers

  function errorMessage(error, fallback) {
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
    if (error && typeof error.error === "string" && error.error.trim()) {
      return error.error.trim();
    }
    return fallback || "Something went wrong.";
  }

  function logToMain(message) {
    try {
      var api = window.electronAPI;
      if (api && typeof api.log === "function") {
        var result = api.log(String(message).slice(0, 4000));
        if (result && typeof result.catch === "function") {
          result.catch(function () {});
        }
      }
    } catch (_) {
      /* logging must never throw */
    }
  }

  function api(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    var bridge = window.electronAPI;
    if (!bridge || typeof bridge[method] !== "function") {
      return Promise.reject(new Error(method + " is not available in this window."));
    }
    try {
      return Promise.resolve(bridge[method].apply(bridge, args));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function withTimeout(promise, ms, message) {
    var timer = 0;
    return Promise.race([
      Promise.resolve(promise).finally(function () {
        clearTimeout(timer);
      }),
      new Promise(function (_, reject) {
        timer = setTimeout(function () {
          reject(new Error(message || "The operation timed out."));
        }, ms);
      }),
    ]);
  }

  function onReady(callback) {
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  // ----------------------------------------------------------------- motion

  var MOTION_VALUES = ["auto", "full", "reduced", "off"];
  var MOTION_STORAGE_KEY = "app-motion";
  // Key used by builds before the UI layer was renamed; read once as a
  // fallback so the chosen animation level survives the update.
  var LEGACY_MOTION_STORAGE_KEY = "atlas-motion";
  var reducedMotionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

  function normalizeMotion(value) {
    var normalized = String(value || "").trim().toLowerCase();
    return MOTION_VALUES.indexOf(normalized) >= 0 ? normalized : "auto";
  }

  function readStoredMotion() {
    try {
      return (
        window.localStorage.getItem(MOTION_STORAGE_KEY) ||
        window.localStorage.getItem(LEGACY_MOTION_STORAGE_KEY)
      );
    } catch (_) {
      return null;
    }
  }

  function applyMotion(value, options) {
    var motion = normalizeMotion(value);
    root.setAttribute("data-motion", motion);
    if (!options || options.persist !== false) {
      try {
        window.localStorage.setItem(MOTION_STORAGE_KEY, motion);
      } catch (_) {
        /* storage may be unavailable */
      }
    }
    return motion;
  }

  function motionLevel() {
    var motion = normalizeMotion(root.getAttribute("data-motion"));
    if (motion === "off" || motion === "reduced") {
      return motion;
    }
    if (motion === "auto" && reducedMotionQuery && reducedMotionQuery.matches) {
      return "reduced";
    }
    return "full";
  }

  // Keep in sync with --app-dur-exit in main.css (plus a small buffer).
  function exitDuration() {
    var level = motionLevel();
    if (level === "off") {
      return 0;
    }
    return level === "reduced" ? 170 : 420;
  }

  applyMotion(readStoredMotion(), { persist: false });

  window.addEventListener("storage", function (event) {
    if (event.key === MOTION_STORAGE_KEY) {
      applyMotion(event.newValue, { persist: false });
    }
  });

  onReady(function () {
    api("getConfig")
      .then(function (config) {
        var configured = config && config.Interface && config.Interface.motion;
        if (configured) {
          applyMotion(configured);
        }
      })
      .catch(function () {});
  });

  // ---------------------------------------------------------- escape stack

  var escapeStack = [];

  function pushEscape(handler) {
    var entry = { handler: handler };
    escapeStack.push(entry);
    return function () {
      var index = escapeStack.indexOf(entry);
      if (index >= 0) {
        escapeStack.splice(index, 1);
      }
    };
  }

  doc.addEventListener(
    "keydown",
    function (event) {
      if (event.key !== "Escape" || event.isComposing || escapeStack.length === 0) {
        return;
      }
      // Fields marked data-escape-local handle Escape themselves (e.g. a
      // search box clearing its query) before any layer is dismissed.
      var localTarget =
        event.target && event.target.closest && event.target.closest("[data-escape-local]");
      if (localTarget) {
        return;
      }
      var top = escapeStack[escapeStack.length - 1];
      event.preventDefault();
      event.stopPropagation();
      try {
        top.handler(event);
      } catch (error) {
        reportError(error, "escape-handler");
      }
    },
    true,
  );

  // --------------------------------------------------------- ripple + press

  var RIPPLE_SELECTOR =
    'button, [role="button"], [role="tab"], [role="option"], a[href], summary, .cursor-pointer, [data-ripple]';

  function isTypingTarget(target) {
    return Boolean(
      target &&
        target.closest &&
        target.closest('input, textarea, select, [contenteditable="true"]'),
    );
  }

  function findInteractive(target) {
    if (!target || !target.closest || isTypingTarget(target)) {
      return null;
    }
    var element = target.closest(RIPPLE_SELECTOR);
    if (!element || element.closest("[data-no-ripple]")) {
      return null;
    }
    if (element.disabled || element.getAttribute("aria-disabled") === "true") {
      return null;
    }
    return element;
  }

  function parseRgb(color) {
    var match = String(color || "").match(/rgba?\(([^)]+)\)/i);
    if (!match) {
      return null;
    }
    var parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return parts.length >= 3 ? parts : null;
  }

  function rippleColorFor(style) {
    var rgb = parseRgb(style.color);
    if (!rgb) {
      return "rgba(255, 255, 255, 0.26)";
    }
    var luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return luminance > 0.45
      ? "rgba(255, 255, 255, 0.26)"
      : "rgba(0, 0, 0, 0.22)";
  }

  function spawnRipple(element, clientX, clientY) {
    if (motionLevel() === "off") {
      return;
    }
    var rect = element.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) {
      return;
    }
    var style = window.getComputedStyle(element);
    if (style.display === "inline" || style.display === "contents") {
      return;
    }

    var restorePosition = false;
    if (style.position === "static") {
      // Making the element relative would move absolutely positioned
      // children, so skip the ripple instead of risking a layout shift.
      if (element.querySelector(".absolute, .fixed")) {
        return;
      }
      element.style.position = "relative";
      restorePosition = true;
    }

    var x = typeof clientX === "number" ? clientX - rect.left : rect.width / 2;
    var y = typeof clientY === "number" ? clientY - rect.top : rect.height / 2;
    var radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
    var size = Math.ceil(radius * 2);

    var host = doc.createElement("span");
    host.className = "app-ripple-host";
    host.setAttribute("aria-hidden", "true");
    var dot = doc.createElement("span");
    dot.className = "app-ripple-dot";
    dot.style.left = x + "px";
    dot.style.top = y + "px";
    dot.style.width = size + "px";
    dot.style.height = size + "px";
    dot.style.background = rippleColorFor(style);
    if (motionLevel() === "reduced") {
      dot.style.animationDuration = "220ms";
    }
    host.appendChild(dot);
    element.appendChild(host);

    var done = false;
    var cleanup = function () {
      if (done) {
        return;
      }
      done = true;
      if (host.parentNode) {
        host.parentNode.removeChild(host);
      }
      if (restorePosition && element.style.position === "relative") {
        element.style.position = "";
      }
    };
    dot.addEventListener("animationend", cleanup, { once: true });
    setTimeout(cleanup, 1000);
  }

  function pressFeedback(element) {
    var level = motionLevel();
    if (level === "off" || typeof element.animate !== "function") {
      return;
    }
    var rect = element.getBoundingClientRect();
    var area = rect.width * rect.height;
    var depth = area > 60000 ? 0.99 : area > 12000 ? 0.98 : 0.94;
    try {
      element.animate(
        [
          { scale: "1" },
          { scale: String(depth), offset: 0.3 },
          { scale: "1" },
        ],
        {
          duration: level === "reduced" ? 200 : 450,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
    } catch (_) {
      /* individual transform properties unsupported */
    }
  }

  function triggerFeedback(element, clientX, clientY) {
    try {
      spawnRipple(element, clientX, clientY);
      pressFeedback(element);
    } catch (error) {
      // Visual feedback must never break the click itself.
      console.warn("[app-ui] feedback failed:", error);
    }
  }

  doc.addEventListener(
    "pointerdown",
    function (event) {
      if (event.button !== 0) {
        return;
      }
      var element = findInteractive(event.target);
      if (element) {
        triggerFeedback(element, event.clientX, event.clientY);
      }
    },
    true,
  );

  doc.addEventListener(
    "keydown",
    function (event) {
      if ((event.key !== "Enter" && event.key !== " ") || event.repeat) {
        return;
      }
      var element = findInteractive(event.target);
      if (element && element === doc.activeElement) {
        triggerFeedback(element);
      }
    },
    true,
  );

  // ----------------------------------------------------------------- toasts

  var TOAST_ICONS = {
    success: "check_circle",
    error: "error",
    warning: "warning",
    info: "info",
    loading: "",
  };
  var TOAST_DURATIONS = {
    success: 4000,
    info: 4500,
    warning: 6500,
    error: 8000,
    loading: 0,
  };
  var MAX_TOASTS = 5;
  var toasts = new Map();
  var toastSequence = 0;
  var viewport = null;

  function getViewport() {
    if (viewport && viewport.isConnected) {
      return viewport;
    }
    viewport = doc.createElement("section");
    viewport.className = "app-toast-viewport";
    viewport.setAttribute("aria-live", "polite");
    viewport.setAttribute("aria-label", "Notifications");
    (doc.body || root).appendChild(viewport);
    return viewport;
  }

  function normalizeToastOptions(input, defaults) {
    var options =
      typeof input === "string" ? { message: input } : Object.assign({}, input);
    if (defaults) {
      for (var key in defaults) {
        if (options[key] === undefined) {
          options[key] = defaults[key];
        }
      }
    }
    var type = Object.prototype.hasOwnProperty.call(TOAST_ICONS, options.type)
      ? options.type
      : "info";
    options.type = type;
    options.title = options.title ? String(options.title) : "";
    options.message = options.message ? String(options.message) : "";
    options.duration =
      typeof options.duration === "number" ? options.duration : TOAST_DURATIONS[type];
    return options;
  }

  function renderToastContent(record) {
    var element = record.element;
    var options = record.options;
    element.setAttribute("data-type", options.type);
    element.setAttribute("role", options.type === "error" ? "alert" : "status");
    element.textContent = "";

    var icon = doc.createElement("span");
    if (options.type === "loading") {
      icon.className = "app-toast__icon app-spinner app-keep-motion";
      icon.style.width = "16px";
      icon.style.height = "16px";
      icon.style.marginTop = "2px";
      icon.style.color = "#66c0f4";
    } else {
      icon.className = "app-toast__icon material-symbols-outlined";
      icon.textContent = TOAST_ICONS[options.type];
    }
    icon.setAttribute("aria-hidden", "true");
    element.appendChild(icon);

    var body = doc.createElement("div");
    body.className = "app-toast__body";
    if (options.title) {
      var title = doc.createElement("div");
      title.className = "app-toast__title";
      title.textContent = options.title;
      body.appendChild(title);
    }
    if (options.message) {
      var message = doc.createElement("div");
      message.className = "app-toast__message";
      message.textContent = options.message;
      body.appendChild(message);
    }
    var actions = Array.isArray(options.actions)
      ? options.actions
      : options.action
        ? [options.action]
        : [];
    if (actions.length > 0) {
      var actionRow = doc.createElement("div");
      actionRow.className = "app-toast__actions";
      actions.forEach(function (action) {
        if (!action || !action.label) {
          return;
        }
        var button = doc.createElement("button");
        button.type = "button";
        button.className = "app-toast__action";
        button.textContent = action.label;
        button.addEventListener("click", function () {
          try {
            if (typeof action.onClick === "function") {
              action.onClick();
            }
          } catch (error) {
            reportError(error, "toast-action");
          }
          if (action.dismiss !== false) {
            dismissToast(record.id);
          }
        });
        actionRow.appendChild(button);
      });
      body.appendChild(actionRow);
    }
    element.appendChild(body);

    if (options.dismissible !== false) {
      var close = doc.createElement("button");
      close.type = "button";
      close.className = "app-toast__close";
      close.setAttribute("aria-label", "Dismiss notification");
      close.setAttribute("data-no-ripple", "");
      close.innerHTML =
        '<span class="material-symbols-outlined" style="font-size:16px" aria-hidden="true">close</span>';
      close.addEventListener("click", function () {
        dismissToast(record.id);
      });
      element.appendChild(close);
    }

    if (options.duration > 0) {
      var timer = doc.createElement("div");
      timer.className = "app-toast__timer app-keep-motion";
      timer.style.animationDuration = options.duration + "ms";
      element.appendChild(timer);
    }
  }

  function clearToastTimer(record) {
    if (record.timerId) {
      clearTimeout(record.timerId);
      record.timerId = 0;
    }
  }

  function scheduleToastTimer(record, duration) {
    clearToastTimer(record);
    if (!(duration > 0)) {
      return;
    }
    record.remaining = duration;
    record.startedAt = Date.now();
    record.timerId = setTimeout(function () {
      dismissToast(record.id);
    }, duration);
  }

  function bumpToast(record) {
    var element = record.element;
    element.classList.remove("app-toast--bump");
    void element.offsetWidth;
    element.classList.add("app-toast--bump");
    scheduleToastTimer(record, record.options.duration);
  }

  function showToast(input, defaults) {
    var options = normalizeToastOptions(input, defaults);

    if (options.id && toasts.has(options.id)) {
      updateToast(options.id, options);
      return options.id;
    }

    var duplicate = null;
    toasts.forEach(function (record) {
      if (
        !record.closing &&
        record.options.type === options.type &&
        record.options.title === options.title &&
        record.options.message === options.message
      ) {
        duplicate = record;
      }
    });
    if (duplicate) {
      bumpToast(duplicate);
      return duplicate.id;
    }

    var id = options.id || "app-toast-" + ++toastSequence;
    var element = doc.createElement("div");
    element.className = "app-toast";
    var record = {
      id: id,
      element: element,
      options: options,
      timerId: 0,
      remaining: options.duration,
      startedAt: Date.now(),
      closing: false,
    };
    renderToastContent(record);

    element.addEventListener("mouseenter", function () {
      if (record.timerId) {
        clearToastTimer(record);
        record.remaining = Math.max(
          800,
          record.remaining - (Date.now() - record.startedAt),
        );
      }
    });
    element.addEventListener("mouseleave", function () {
      if (!record.closing && record.options.duration > 0 && !record.timerId) {
        scheduleToastTimer(record, record.remaining);
      }
    });

    toasts.set(id, record);
    getViewport().appendChild(element);
    scheduleToastTimer(record, options.duration);

    var active = [];
    toasts.forEach(function (item) {
      if (!item.closing) {
        active.push(item);
      }
    });
    while (active.length > MAX_TOASTS) {
      var oldest = active.shift();
      if (oldest.options.type === "loading" && active.length > 0) {
        active.push(oldest);
        continue;
      }
      dismissToast(oldest.id);
    }

    return id;
  }

  function updateToast(id, patch) {
    var record = toasts.get(id);
    if (!record || record.closing) {
      return patch ? showToast(Object.assign({}, patch, { id: id })) : null;
    }
    var merged = Object.assign({}, record.options, patch || {});
    if (patch && patch.type && typeof patch.duration !== "number") {
      merged.duration = TOAST_DURATIONS[patch.type];
    }
    record.options = normalizeToastOptions(merged);
    renderToastContent(record);
    scheduleToastTimer(record, record.options.duration);
    return id;
  }

  function dismissToast(id) {
    var record = toasts.get(id);
    if (!record || record.closing) {
      return;
    }
    record.closing = true;
    clearToastTimer(record);
    var element = record.element;
    var finish = function () {
      toasts.delete(id);
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    };
    var duration = exitDuration();
    if (!duration || typeof element.animate !== "function") {
      finish();
      return;
    }
    var height = element.offsetHeight;
    element.style.pointerEvents = "none";
    var animation = element.animate(
      [
        {
          opacity: 1,
          transform: "none",
          height: height + "px",
          marginTop: "8px",
        },
        {
          opacity: 0,
          transform: "translate3d(40%, 0, 0) scale(0.96)",
          height: "0px",
          marginTop: "0px",
          paddingTop: "0px",
          paddingBottom: "0px",
        },
      ],
      {
        duration: duration + 60,
        easing: "cubic-bezier(0.55, 0, 0.75, 0.2)",
        fill: "forwards",
      },
    );
    animation.onfinish = finish;
    animation.oncancel = finish;
  }

  function toastPromise(promise, messages) {
    var labels = messages || {};
    var id = showToast({
      type: "loading",
      title: labels.loadingTitle || "",
      message: labels.loading || "Working...",
      dismissible: false,
    });
    return Promise.resolve(promise).then(
      function (value) {
        var text =
          typeof labels.success === "function" ? labels.success(value) : labels.success;
        if (text) {
          updateToast(id, { type: "success", message: text, dismissible: true });
        } else {
          dismissToast(id);
        }
        return value;
      },
      function (error) {
        var text =
          typeof labels.error === "function"
            ? labels.error(error)
            : labels.error || errorMessage(error);
        updateToast(id, { type: "error", message: text, dismissible: true });
        throw error;
      },
    );
  }

  var toast = {
    show: showToast,
    update: updateToast,
    dismiss: dismissToast,
    promise: toastPromise,
    success: function (message, options) {
      return showToast(Object.assign({ message: message }, options, { type: "success" }));
    },
    error: function (message, options) {
      return showToast(Object.assign({ message: message }, options, { type: "error" }));
    },
    warning: function (message, options) {
      return showToast(Object.assign({ message: message }, options, { type: "warning" }));
    },
    info: function (message, options) {
      return showToast(Object.assign({ message: message }, options, { type: "info" }));
    },
    loading: function (message, options) {
      return showToast(
        Object.assign({ message: message, dismissible: false }, options, {
          type: "loading",
        }),
      );
    },
  };

  // --------------------------------------------------- confirm / alert dialog

  var FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function trapFocus(container, event) {
    if (event.key !== "Tab") {
      return;
    }
    var focusable = Array.prototype.filter.call(
      container.querySelectorAll(FOCUSABLE_SELECTOR),
      function (node) {
        return node.offsetParent !== null || node === doc.activeElement;
      },
    );
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === container)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDialog(input, withCancel) {
    var options = typeof input === "string" ? { message: input } : Object.assign({}, input);
    return new Promise(function (resolve) {
      var previousFocus = doc.activeElement;
      var overlay = doc.createElement("div");
      overlay.className = "app-confirm-overlay app-overlay";
      overlay.setAttribute("data-state", "open");

      var dialog = doc.createElement("div");
      dialog.className = "app-confirm app-dialog";
      dialog.setAttribute("data-state", "open");
      dialog.setAttribute("role", withCancel ? "alertdialog" : "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.tabIndex = -1;

      var header = doc.createElement("div");
      header.className = "app-confirm__header";
      header.textContent = options.title || (withCancel ? "Are you sure?" : "Notice");
      header.id = "app-confirm-title-" + ++toastSequence;
      dialog.setAttribute("aria-labelledby", header.id);
      dialog.appendChild(header);

      if (options.message) {
        var message = doc.createElement("div");
        message.className = "app-confirm__message";
        message.textContent = options.message;
        dialog.appendChild(message);
      }

      var footer = doc.createElement("div");
      footer.className = "app-confirm__footer";
      var cancelButton = null;
      if (withCancel) {
        cancelButton = doc.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "app-confirm__btn";
        cancelButton.textContent = options.cancelLabel || "Cancel";
        footer.appendChild(cancelButton);
      }
      var confirmButton = doc.createElement("button");
      confirmButton.type = "button";
      confirmButton.className =
        "app-confirm__btn " +
        (options.tone === "danger" ? "app-confirm__btn--danger" : "app-confirm__btn--primary");
      confirmButton.textContent = options.confirmLabel || (withCancel ? "Confirm" : "OK");
      footer.appendChild(confirmButton);
      dialog.appendChild(footer);
      overlay.appendChild(dialog);

      var settled = false;
      var releaseEscape = function () {};
      var close = function (result) {
        if (settled) {
          return;
        }
        settled = true;
        releaseEscape();
        overlay.setAttribute("data-state", "closed");
        dialog.setAttribute("data-state", "closed");
        setTimeout(function () {
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
        }, exitDuration());
        if (previousFocus && typeof previousFocus.focus === "function" && previousFocus.isConnected) {
          try {
            previousFocus.focus({ preventScroll: true });
          } catch (_) {
            /* ignore */
          }
        }
        resolve(result);
      };

      confirmButton.addEventListener("click", function () {
        close(true);
      });
      if (cancelButton) {
        cancelButton.addEventListener("click", function () {
          close(false);
        });
      }
      overlay.addEventListener("mousedown", function (event) {
        if (event.target === overlay) {
          close(withCancel ? false : true);
        }
      });
      dialog.addEventListener("keydown", function (event) {
        trapFocus(dialog, event);
      });
      releaseEscape = pushEscape(function () {
        close(withCancel ? false : true);
      });

      (doc.body || root).appendChild(overlay);
      var initialFocus =
        options.tone === "danger" && cancelButton ? cancelButton : confirmButton;
      setTimeout(function () {
        try {
          initialFocus.focus({ preventScroll: true });
        } catch (_) {
          dialog.focus();
        }
      }, 30);
    });
  }

  // ------------------------------------------------------------------- boot

  var BOOT_TIMEOUT_MS = 25000;
  var boot = { ready: false, failed: false, errors: [], timer: 0 };

  function bootElement() {
    return doc.getElementById("app-boot");
  }

  function setBootText(selector, value) {
    var element = bootElement();
    var node = element && element.querySelector(selector);
    if (node) {
      node.textContent = value;
    }
  }

  function markBootReady() {
    if (boot.ready) {
      return;
    }
    boot.ready = true;
    clearTimeout(boot.timer);
    var element = bootElement();
    if (!element) {
      return;
    }
    element.setAttribute("data-state", "done");
    setTimeout(function () {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }, 900);
  }

  function failBoot(title, details) {
    if (boot.ready) {
      return;
    }
    boot.failed = true;
    if (details) {
      boot.errors.push(String(details));
    }
    var element = bootElement();
    if (!element) {
      return;
    }
    element.setAttribute("data-state", "error");
    setBootText("[data-boot-error-title]", title || "The interface could not start");
    setBootText(
      "[data-boot-error-message]",
      "Reload the window to try again. If this keeps happening, copy the details below when reporting the problem.",
    );
    setBootText("[data-boot-error-details]", boot.errors.slice(-6).join("\n\n"));
  }

  function setBootStatus(text) {
    setBootText(".app-boot__status", text);
  }

  function wireBootScreen() {
    var element = bootElement();
    if (!element) {
      boot.ready = true;
      return;
    }
    element.addEventListener("click", function (event) {
      var button = event.target.closest && event.target.closest("[data-boot-action]");
      if (!button) {
        return;
      }
      var action = button.getAttribute("data-boot-action");
      if (action === "reload") {
        window.location.reload();
      } else if (action === "close") {
        api("closeWindow").catch(function () {
          window.close();
        });
      } else if (action === "copy") {
        var details = boot.errors.join("\n\n") || "No error details were captured.";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(details).then(
            function () {
              button.textContent = "Copied";
            },
            function () {},
          );
        }
      }
    });

    var mount = doc.getElementById("root");
    if (mount) {
      var check = function () {
        if (mount.childElementCount > 0) {
          observer.disconnect();
          requestAnimationFrame(function () {
            requestAnimationFrame(markBootReady);
          });
        }
      };
      var observer = new MutationObserver(check);
      observer.observe(mount, { childList: true });
      check();
    }

    boot.timer = setTimeout(function () {
      if (!boot.ready) {
        failBoot(
          "The interface is taking too long to start",
          boot.errors.length ? "" : "No script errors were reported before the timeout.",
        );
      }
    }, BOOT_TIMEOUT_MS);
  }

  onReady(wireBootScreen);

  // ------------------------------------------------------- error reporting

  var IGNORED_ERRORS = [
    /ResizeObserver loop/i,
    /You are using the in-browser Babel transformer/i,
  ];
  var recentErrorToasts = new Map();

  function isIgnoredError(message) {
    return IGNORED_ERRORS.some(function (pattern) {
      return pattern.test(message);
    });
  }

  function reportError(error, context) {
    var message = errorMessage(error, "Unknown error");
    if (isIgnoredError(message)) {
      return;
    }
    var stack = error && error.stack ? String(error.stack) : "";
    logToMain("[ui-error]" + (context ? "[" + context + "] " : " ") + message + (stack ? "\n" + stack : ""));

    if (!boot.ready) {
      failBoot("The interface could not start", message + (stack ? "\n" + stack : ""));
      return;
    }

    var now = Date.now();
    var last = recentErrorToasts.get(message) || 0;
    if (now - last < 30000) {
      return;
    }
    recentErrorToasts.set(message, now);
    showToast({
      type: "error",
      title: "Something went wrong",
      message: message,
      actions: [
        {
          label: "Reload window",
          onClick: function () {
            window.location.reload();
          },
        },
      ],
    });
  }

  window.addEventListener(
    "error",
    function (event) {
      var target = event.target;
      if (target && target !== window && target.tagName) {
        var tag = target.tagName.toUpperCase();
        if (tag === "SCRIPT" || (tag === "LINK" && target.rel === "stylesheet")) {
          var source = target.src || target.href || "resource";
          logToMain("[ui-error] Failed to load " + source);
          if (!boot.ready) {
            failBoot("A required UI file failed to load", "Failed to load " + source);
          }
        }
        return;
      }
      reportError(event.error || event.message, "window.onerror");
    },
    true,
  );

  window.addEventListener("unhandledrejection", function (event) {
    reportError(event.reason, "unhandledrejection");
  });

  // --------------------------------------------------------- connectivity

  window.addEventListener("offline", function () {
    showToast({
      id: "app-network",
      type: "warning",
      title: "You're offline",
      message:
        "F95 search, downloads and cloud sync pause until the connection is back. Your library keeps working.",
      duration: 0,
    });
  });

  window.addEventListener("online", function () {
    if (toasts.has("app-network")) {
      updateToast("app-network", {
        type: "success",
        title: "Back online",
        message: "Connection restored.",
        duration: 3500,
      });
    }
  });

  // ---------------------------------------------------------------- export

  window.AppUI = {
    api: api,
    withTimeout: withTimeout,
    errorMessage: errorMessage,
    reportError: reportError,
    log: logToMain,
    pushEscape: pushEscape,
    trapFocus: trapFocus,
    feedback: triggerFeedback,
    motion: {
      apply: applyMotion,
      level: motionLevel,
      exitDuration: exitDuration,
      values: MOTION_VALUES.slice(),
    },
    toast: toast,
    confirm: function (options) {
      return openDialog(options, true);
    },
    alert: function (options) {
      return openDialog(options, false);
    },
    boot: {
      markReady: markBootReady,
      fail: failBoot,
      setStatus: setBootStatus,
      isReady: function () {
        return boot.ready;
      },
    },
  };
  window.AppToast = toast;
})();
