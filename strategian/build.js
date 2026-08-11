#!/usr/bin/env node
/* Bundles STRATEGIAN into single self-contained files.
 *
 *   node build.js
 *
 * Produces two outputs in dist/:
 *   strategian.html   a complete page — open it directly, email it, host it
 *   fragment.html     the same content without the document shell, for hosts
 *                     that supply their own <head>/<body>
 *
 * There is no minifier and no dependency; the point is that the output is
 * readable and that this script stays obvious.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Load order matters: utilities, then data, then simulation, then the shell.
const SCRIPTS = [
  'js/util.js', 'js/data-world.js', 'js/sim-economy.js', 'js/sim-society.js',
  'js/sim-military.js', 'js/sim-diplomacy.js', 'js/negotiation.js', 'js/news.js',
  'js/briefings.js', 'js/data-decisions.js', 'js/data-events.js', 'js/game.js',
  'js/ui.js', 'js/main.js'
];

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// A closing script tag inside a string literal would end the inline block.
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const css = read('css/strategian.css');
const js = SCRIPTS.map((f) => '/* ==== ' + f + ' ==== */\n' + safe(read(f))).join('\n\n');

const TITLE = 'STRATEGIAN';
const DESC = 'A long-form government management simulation: rule on the issues that reach your desk and watch them move the economy, society, armed forces and international system.';

const fragment =
  '<title>' + TITLE + '</title>\n' +
  '<meta name="description" content="' + DESC + '">\n' +
  '<style>\n' + css + '\n</style>\n' +
  '<div id="app"></div>\n' +
  '<script>\n' + js + '\n</script>\n';

const page =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<meta name="color-scheme" content="dark light">\n' +
  fragment.split('\n').slice(0, 2).join('\n') + '\n' +
  '<style>\n' + css + '\n</style>\n' +
  '</head>\n<body>\n<div id="app"></div>\n' +
  '<script>\n' + js + '\n</script>\n' +
  '</body>\n</html>\n';

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'strategian.html'), page);
fs.writeFileSync(path.join(DIST, 'fragment.html'), fragment);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log('dist/strategian.html  ' + kb(page));
console.log('dist/fragment.html    ' + kb(fragment));
