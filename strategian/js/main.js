/* STRATEGIAN — bootstrap */
(function (S) {
  'use strict';

  function boot() {
    try {
      const theme = localStorage.getItem('strategian.theme');
      if (theme) document.documentElement.setAttribute('data-theme', theme);
    } catch (e) { /* private mode */ }

    // Guard against a half-loaded page.
    const missing = ['Econ', 'Soc', 'Mil', 'Dip', 'Nego', 'News', 'Brief', 'game', 'UI']
      .filter((k) => !S[k]);
    if (missing.length) {
      document.getElementById('app').innerHTML =
        '<div style="padding:40px;font-family:sans-serif">Failed to load: ' + missing.join(', ') +
        '. Make sure every file in <code>js/</code> is present.</div>';
      return;
    }
    S.UI.showSetup();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.S);
