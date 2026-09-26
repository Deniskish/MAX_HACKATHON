// Production frontend behind the existing HTTPS ingress; API stays on port 3002.
const express = require('express');
const compression = require('compression');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('node:path');
const fs = require('node:fs');

function createApp({ root = path.resolve(__dirname, '../dist'), api = 'http://127.0.0.1:3002' } = {}) {
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Run npm run build before starting the frontend');
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  // Compress proxied catalogue JSON too: the live catalogue is several MB raw.
  app.use(compression());
  // Proxy the original path and body without parsing documents or JSON here.
  app.use(createProxyMiddleware({
    pathFilter: (pathname) => pathname === '/api' || pathname.startsWith('/api/'),
    target: api,
    proxyTimeout: 75000,
    on: { error: (_error, _req, res) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Сервис временно недоступен. Повторите запрос позже.', code: 'UPSTREAM_UNAVAILABLE' }));
    } },
  }));
  app.use(express.static(root, {
    dotfiles: 'deny',
    setHeaders(res, filename) {
      const hashed = /-[\w-]{8,}\.(?:js|css|woff2|webp|avif|png|jpe?g|svg)$/.test(path.basename(filename));
      res.setHeader('Cache-Control', path.basename(filename) === 'version.json' ? 'no-store' : filename.endsWith('.html') ? 'no-cache'
        : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    },
  }));
  app.use((req, res) => {
    if (['GET', 'HEAD'].includes(req.method) && !path.extname(req.path)
      && !req.path.split('/').some((part) => part.startsWith('.') || part.startsWith('@'))
      && !/^\/(?:assets|ocr|src|node_modules|api-server)(?:\/|$)/.test(req.path)
      && req.accepts('html')) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(path.join(root, 'index.html'));
    }
    res.status(404).type('text').send('Not found');
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createApp().listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`Production frontend listening on port ${port}`);
    process.send?.('ready');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
module.exports = { createApp };
