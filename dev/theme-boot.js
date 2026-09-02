(function () {
  var KEY = 'leadlens.theme';
  var pref = localStorage.getItem(KEY);
  if (pref !== 'light' && pref !== 'dark') pref = 'system';
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

  var path = location.pathname || '';
  if (path === '/dev' || path.indexOf('/dev/') === 0) {
    document.documentElement.classList.add('ll-dev-preview');
    function injectBanner() {
      if (!document.body || document.getElementById('ll-preview-banner')) return;
      var el = document.createElement('div');
      el.id = 'll-preview-banner';
      el.className = 'll-preview-banner';
      el.setAttribute('role', 'status');
      el.textContent = 'Preview';
      document.body.insertBefore(el, document.body.firstChild);
    }
    if (document.body) injectBanner();
    else document.addEventListener('DOMContentLoaded', injectBanner);
  }
})();
