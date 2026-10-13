import http from 'node:http';
import { loadConfig } from './config.js';
import { loadKnowledge } from './knowledge.js';
import { OllamaService } from './ollama.js';
import { makeTurnstileVerifier } from './security.js';
import { createApp } from './app.js';

async function main() {
  const config = loadConfig();
  const service = await createApp({
    config,
    model: new OllamaService(config),
    knowledge: loadKnowledge(),
    verify: makeTurnstileVerifier(config),
  });
  // Separate loopback-only diagnostics. Never routed through the public listener or tunnel.
  const diagnostics = http.createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(service.snapshot()));
  });
  diagnostics.listen(19091, '127.0.0.1');
  diagnostics.on('error', () => {
    service.app.log.error({ event: 'diagnostics_failed' });
    void service.app.close().finally(() => process.exit(1));
  });
  await service.app.listen({ host: config.host, port: config.port });
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    const force = setTimeout(() => process.exit(1), 12000);
    force.unref();
    diagnostics.close();
    await service.app.close();
    clearTimeout(force);
  }
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}
main().catch(() => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'startup_failed',
      message: 'Validate local configuration and secret files. No sensitive details are logged.',
    }),
  );
  process.exitCode = 1;
});
