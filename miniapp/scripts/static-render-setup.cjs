// Static markup tests run in Node, without Vite's asset loader or a browser.
// Use a fixed theme only in this test process; interactive behavior is checked in Playwright.
global.window = { matchMedia: () => ({ matches: true }) };
// tsx may compile imported components with the classic JSX runtime outside Vite.
global.React = require('react');
require.extensions['.webp'] = (module, filename) => { module.exports = filename; };
