// React helpers shared by the renderer windows (plain JS, no JSX, so it
// loads before Babel runs): presence-based enter/exit animations, the Escape
// stack, dialog focus handling, busy-guarded async actions and an error
// boundary that keeps one broken panel from blanking the whole window.
(function () {
  "use strict";

  var React = window.React;
  var AppUI = window.AppUI;
  if (!React || !AppUI || window.AppMotion) {
    return;
  }

  var h = React.createElement;
  var useEffect = React.useEffect;
  var useLayoutEffect = React.useLayoutEffect;
  var useRef = React.useRef;
  var useState = React.useState;
  var useCallback = React.useCallback;

  // Keeps a component mounted while its exit animation plays.
  // Returns { isMounted, state } where state is "open" or "closed"; put
  // `data-state={state}` on elements styled with the .atlas-* presence classes.
  function usePresence(isOpen) {
    var initial = isOpen ? "open" : "unmounted";
    var pair = useState(initial);
    var phase = pair[0];
    var setPhase = pair[1];

    useEffect(
      function () {
        if (isOpen) {
          setPhase("open");
          return undefined;
        }
        setPhase(function (current) {
          return current === "unmounted" ? current : "closed";
        });
        var timer = setTimeout(function () {
          setPhase("unmounted");
        }, AppUI.motion.exitDuration());
        return function () {
          clearTimeout(timer);
        };
      },
      [isOpen],
    );

    return {
      isMounted: Boolean(isOpen) || phase !== "unmounted",
      state: isOpen ? "open" : "closed",
      isClosing: !isOpen && phase !== "unmounted",
    };
  }

  // Returns `value` while `active` is true and the last active value after,
  // so closing panels keep rendering their content during the exit animation.
  function useSnapshot(value, active) {
    var ref = useRef(value);
    if (active) {
      ref.current = value;
    }
    return active ? value : ref.current;
  }

  function useLatest(value) {
    var ref = useRef(value);
    ref.current = value;
    return ref;
  }

  // Registers an Escape handler on the global stack while `active`; only the
  // most recently opened layer receives the key.
  function useEscape(active, handler) {
    var handlerRef = useLatest(handler);
    useEffect(
      function () {
        if (!active) {
          return undefined;
        }
        return AppUI.pushEscape(function (event) {
          if (typeof handlerRef.current === "function") {
            handlerRef.current(event);
          }
        });
      },
      [active],
    );
  }

  // Moves focus into a dialog when it opens, traps Tab inside it and restores
  // the previously focused element when it closes.
  function useDialogFocus(active, containerRef) {
    useEffect(
      function () {
        if (!active) {
          return undefined;
        }
        var previous = document.activeElement;
        var frame = requestAnimationFrame(function () {
          var container = containerRef.current;
          if (container && !container.contains(document.activeElement)) {
            try {
              container.focus({ preventScroll: true });
            } catch (_) {
              /* ignore */
            }
          }
        });
        var onKeyDown = function (event) {
          var container = containerRef.current;
          if (container && container.contains(event.target)) {
            AppUI.trapFocus(container, event);
          }
        };
        document.addEventListener("keydown", onKeyDown);
        return function () {
          cancelAnimationFrame(frame);
          document.removeEventListener("keydown", onKeyDown);
          if (previous && previous.isConnected && typeof previous.focus === "function") {
            try {
              previous.focus({ preventScroll: true });
            } catch (_) {
              /* ignore */
            }
          }
        };
      },
      [active],
    );
  }

  // Everything a modal layer needs in one call: exit animation, a snapshot of
  // its props while closing, Escape-to-close and focus handling.
  function useModalLayer(isOpen, props, options) {
    var opts = options || {};
    var presence = usePresence(isOpen);
    var snapshot = useSnapshot(props, isOpen);
    var dialogRef = useRef(null);
    useEscape(Boolean(isOpen) && opts.closeOnEscape !== false, function () {
      if (typeof opts.onClose === "function") {
        opts.onClose();
      }
    });
    useDialogFocus(Boolean(isOpen) && opts.manageFocus !== false, dialogRef);
    return {
      isMounted: presence.isMounted,
      state: presence.state,
      props: snapshot,
      dialogRef: dialogRef,
    };
  }

  // Wraps an async action so double clicks do nothing while it runs and
  // failures surface as a toast instead of an unhandled rejection.
  function useBusyAction(options) {
    var pair = useState(false);
    var busy = pair[0];
    var setBusy = pair[1];
    var busyRef = useRef(false);
    var mountedRef = useRef(true);
    var optionsRef = useLatest(options || {});

    useEffect(function () {
      mountedRef.current = true;
      return function () {
        mountedRef.current = false;
      };
    }, []);

    var run = useCallback(function (action) {
      if (busyRef.current) {
        return Promise.resolve(undefined);
      }
      busyRef.current = true;
      setBusy(true);
      return Promise.resolve()
        .then(action)
        .catch(function (error) {
          var opts = optionsRef.current;
          if (opts.silent !== true) {
            AppUI.toast.error(AppUI.errorMessage(error, opts.errorMessage), {
              title: opts.errorTitle || "Action failed",
            });
          }
          console.error("[app] action failed:", error);
          return undefined;
        })
        .finally(function () {
          busyRef.current = false;
          if (mountedRef.current) {
            setBusy(false);
          }
        });
    }, []);

    return [busy, run];
  }

  // Adds a class for one animation cycle whenever `trigger` changes (after
  // the first render). Useful for "pop" feedback on toggles and counters.
  function useFlashClass(trigger, className) {
    var ref = useRef(null);
    var firstRef = useRef(true);
    useLayoutEffect(
      function () {
        if (firstRef.current) {
          firstRef.current = false;
          return;
        }
        var node = ref.current;
        if (!node) {
          return;
        }
        node.classList.remove(className);
        void node.offsetWidth;
        node.classList.add(className);
      },
      [trigger],
    );
    return ref;
  }

  // -------------------------------------------------------- error boundary

  function CrashFallback(props) {
    var error = props.error;
    var isScreen = props.variant === "screen";
    var message = AppUI.errorMessage(error, "Unknown rendering error.");
    return h(
      "div",
      {
        className: "app-crash" + (isScreen ? " app-crash--screen" : ""),
        role: "alert",
      },
      h(
        "span",
        {
          className: "material-symbols-outlined",
          style: { fontSize: 32, color: "#fca5a5" },
          "aria-hidden": "true",
        },
        "report",
      ),
      h(
        "div",
        { className: "app-crash__title" },
        props.title ||
          (isScreen ? "F95Launcher hit an unexpected error" : "This section failed to load"),
      ),
      h("div", { className: "app-crash__message" }, message),
      h(
        "div",
        { className: "app-crash__actions" },
        h(
          "button",
          { type: "button", "data-primary": "", onClick: props.onRetry },
          "Try again",
        ),
        h(
          "button",
          {
            type: "button",
            onClick: function () {
              window.location.reload();
            },
          },
          "Reload window",
        ),
        isScreen
          ? h(
              "button",
              {
                type: "button",
                onClick: function () {
                  AppUI.api("closeWindow").catch(function () {
                    window.close();
                  });
                },
              },
              "Close window",
            )
          : null,
      ),
    );
  }

  class AppErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { error: null };
      this.reset = this.reset.bind(this);
    }

    static getDerivedStateFromError(error) {
      return { error: error || new Error("Unknown rendering error.") };
    }

    componentDidCatch(error, info) {
      var name = this.props.name || "component";
      console.error("[app] render error in " + name + ":", error, info);
      AppUI.log(
        "[ui-error][boundary:" +
          name +
          "] " +
          AppUI.errorMessage(error, "Unknown rendering error") +
          (info && info.componentStack ? "\n" + info.componentStack : ""),
      );
    }

    componentDidUpdate(previousProps) {
      if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
        this.reset();
      }
    }

    reset() {
      this.setState({ error: null });
    }

    render() {
      if (!this.state.error) {
        return this.props.children === undefined ? null : this.props.children;
      }
      if (this.props.variant === "silent") {
        return null;
      }
      if (typeof this.props.fallback === "function") {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return h(CrashFallback, {
        error: this.state.error,
        variant: this.props.variant,
        title: this.props.title,
        onRetry: this.reset,
      });
    }
  }

  // Convenience wrapper: <AppSafe name="Downloads">...</AppSafe>
  function AppSafe(props) {
    return h(AppErrorBoundary, props, props.children);
  }

  // Sets `data-loaded` once an <img> finishes loading so CSS can fade it in,
  // and swaps to a fallback node when the image cannot be loaded.
  function AppImage(props) {
    var src = props.src;
    var pair = useState({ src: src, status: src ? "loading" : "error" });
    var current = pair[0];
    var setCurrent = pair[1];
    var status =
      current.src === src ? current.status : src ? "loading" : "error";
    if (current.src !== src) {
      // Derived-state reset during render: React re-renders immediately.
      setCurrent({ src: src, status: status });
    }
    var setStatus = function (nextStatus) {
      setCurrent({ src: src, status: nextStatus });
    };

    if (!src || status === "error") {
      return props.fallback === undefined ? null : props.fallback;
    }

    var rest = {};
    for (var key in props) {
      if (key !== "fallback" && key !== "className") {
        rest[key] = props[key];
      }
    }
    rest.className = (props.className || "") + " app-img-fade";
    rest["data-loaded"] = status === "loaded" ? "true" : "false";
    rest.decoding = props.decoding || "async";
    rest.onLoad = function (event) {
      setStatus("loaded");
      if (typeof props.onLoad === "function") {
        props.onLoad(event);
      }
    };
    rest.onError = function (event) {
      setStatus("error");
      if (typeof props.onError === "function") {
        props.onError(event);
      }
    };
    return h("img", rest);
  }

  window.AppMotion = {
    usePresence: usePresence,
    useSnapshot: useSnapshot,
    useLatest: useLatest,
    useEscape: useEscape,
    useDialogFocus: useDialogFocus,
    useModalLayer: useModalLayer,
    useBusyAction: useBusyAction,
    useFlashClass: useFlashClass,
  };
  window.AppErrorBoundary = AppErrorBoundary;
  window.AppSafe = AppSafe;
  window.AppImage = AppImage;
})();
