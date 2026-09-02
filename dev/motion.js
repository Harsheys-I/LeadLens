/**
 * Lightweight motion helpers — spring CSS + tiny JS hooks (no React/build step).
 */
(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  document.documentElement.classList.add("ll-motion");

  function restartAnimation(el, className) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  window.llMotion = {
    pulse(el, className = "ll-pulse") {
      restartAnimation(el, className);
    },
    viewEnter(viewEl) {
      if (!viewEl) return;
      viewEl.classList.remove("ll-view-enter");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          viewEl.classList.add("ll-view-enter");
        });
      });
    },
  };

  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest(".primary-button, .secondary-button, .danger-button, .icon-button");
      if (!btn || btn.disabled) return;
      restartAnimation(btn, "ll-tap");
    },
    true,
  );
})();
