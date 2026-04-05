(function () {
  const REVEAL_CLASS = "atlas-scrollbar-reveal";
  const HIDE_AFTER_MS = 900;
  let hideTimer = 0;

  function reveal() {
    document.documentElement.classList.add(REVEAL_CLASS);
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () {
      document.documentElement.classList.remove(REVEAL_CLASS);
    }, HIDE_AFTER_MS);
  }

  document.addEventListener("scroll", reveal, true);
})();
