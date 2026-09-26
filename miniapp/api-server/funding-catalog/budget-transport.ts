import { Agent, request } from 'node:https';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import intermediate from './budget-intermediate.json';

// The portal omits its GlobalSign intermediate. Supply the CA published by GlobalSign,
// scoped to this connector. Hostname, validity and certificate-chain checks remain enabled.
// No global TLS settings or trust-store changes; no certificates downloaded at runtime.
const certificate = new X509Certificate(intermediate.pem);
if (!certificate.ca || certificate.fingerprint.replaceAll(':', '').toLowerCase() !== intermediate.sha1) throw new Error('INVALID_BUDGET_CA');
let agent: Agent | undefined;
export const budgetTransport: typeof fetch = async (url, init) => {
  const target = new URL(String(url));
  if (target.origin !== 'https://promote.budget.gov.ru' || target.username || target.password) throw new Error('INVALID_BUDGET_URL');
  if (!agent) {
    const extra = process.env.NODE_EXTRA_CA_CERTS ? readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8') : '';
    agent = new Agent({ keepAlive: true, maxSockets: 3, ca: [...rootCertificates, intermediate.pem, ...(extra ? [extra] : [])] });
  }
  return new Promise<Response>((resolve, reject) => {
    const req = request(target, { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)),
      agent, signal: init?.signal ?? undefined }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (data: Buffer) => { size += data.length;
        if (size > 2_000_000) { res.destroy(new Error('BUDGET_RESPONSE_TOO_LARGE')); return; } chunks.push(data); });
      res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 502,
        headers: { 'Content-Type': 'application/json' } })));
    });
    req.on('error', reject); req.end(typeof init?.body === 'string' ? init.body : undefined);
  });
};
