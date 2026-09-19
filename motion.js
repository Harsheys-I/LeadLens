/**
 * Lightweight motion helpers — soft CSS + tiny JS hooks (no React/build step).
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

  function enterHomeTiles(mount) {
    if (!mount) return;
    const tiles = [...mount.querySelectorAll(".home-tile")];
    tiles.forEach((tile, i) => {
      tile.classList.remove("ll-tile-enter");
      tile.style.animationDelay = `${i * 0.06}s`;
      const clear = () => {
        tile.classList.remove("ll-tile-enter");
        tile.style.removeProperty("animation-delay");
        tile.removeEventListener("animationend", clear);
      };
      tile.addEventListener("animationend", clear);
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tiles.forEach((tile) => tile.classList.add("ll-tile-enter"));
      });
    });
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
    enterHomeTiles,
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
