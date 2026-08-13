/* Animazing — file-based content pack registry.
 *
 * Packs exported from the Studio ("Export auto-loading pack (.js)") can be
 * made a permanent part of the game:
 *
 *   1. Drop the exported file into this packs/ folder,
 *      e.g. packs/my-animazing-pack.pack.js
 *   2. Add a script tag for it in index.html, directly BELOW the
 *      packs/index.js tag:
 *        <script src="packs/my-animazing-pack.pack.js"></script>
 *   3. Commit both files. Every player now gets that content built in —
 *      no browser storage involved.
 *
 * Pack files push a layer object onto AZ.PACKS; the content registry merges
 * layers in order (starter -> packs -> local Studio content), with later
 * layers overriding earlier ones by id. See packs/README.md for details.
 */
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.AZ = root.AZ || {};
  root.AZ.PACKS = root.AZ.PACKS || [];
})();
