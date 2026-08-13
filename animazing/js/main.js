/* Animazing — boot sequence. */
(function (AZ) {
  'use strict';
  if (typeof document === 'undefined') return;

  function seedPackImages() {
    /* File-based packs may carry their images inline; make them renderable. */
    var writes = [];
    (AZ.PACKS || []).forEach(function (pack) {
      Object.keys(pack.images || {}).forEach(function (id) {
        if (!AZ.storage.getImage(id)) writes.push(AZ.storage.putImage(id, pack.images[id]));
      });
    });
    return Promise.all(writes);
  }

  function boot() {
    AZ.content.init();
    AZ.state.init();
    AZ.storage.preloadMedia()
      .then(seedPackImages)
      .then(function () {
        /* Content that exists (Studio creations, file packs) should be usable. */
        if (AZ.studioGrantAllCustom) AZ.studioGrantAllCustom();

        document.querySelectorAll('.nav-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            AZ.ui.showScreen(btn.getAttribute('data-screen'));
          });
        });
        document.getElementById('brand-home').addEventListener('click', function () {
          AZ.ui.showScreen('hub');
        });
        AZ.ui.bindTilt(document.body);
        AZ.ui.showScreen('title');

        if (!AZ.storage.isPersistent()) {
          setTimeout(function () {
            AZ.ui.toast('This browser blocks local storage here — the game plays fine, but progress and Studio art won’t survive a reload. Export packs to keep them.', 'info');
          }, 1400);
        }
      })
      .catch(function (err) {
        console.error('Boot failed:', err);
        var el = document.getElementById('screen-title');
        el.classList.add('active');
        el.innerHTML = '<div class="title-wrap"><h1 class="title-logo gold-text">ANIMAZING</h1>' +
          '<p style="color:#e0aeb2">Something failed while loading: ' + AZ.util.esc(err.message) + '</p></div>';
      });
  }

  window.addEventListener('error', function (e) {
    if (AZ.ui && AZ.ui.toast) AZ.ui.toast('Unexpected error: ' + AZ.util.esc(e.message), 'error');
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));
