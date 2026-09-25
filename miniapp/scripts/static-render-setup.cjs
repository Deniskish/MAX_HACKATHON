// Static markup tests run in Node, without Vite's asset loader or a browser.
// Use a fixed theme only in this test process; interactive behavior is checked in Playwright.
global.window = { matchMedia: () => ({ matches: true }) };
require.extensions['.webp'] = (module, filename) => { module.exports = filename; };
