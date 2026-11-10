const { createApi } = require('./app');

const logFatal = (kind, error) => {
  console.error(`[account-server] ${kind}`, error?.stack || error?.message || error);
};
process.on('uncaughtException', error => logFatal('uncaughtException', error));
process.on('unhandledRejection', error => logFatal('unhandledRejection', error));
process.on('SIGTERM', () => console.warn('[account-server] SIGTERM received'));
process.on('SIGINT', () => console.warn('[account-server] SIGINT received'));

for (const key of ['TELEGRAM_BOT_TOKEN', 'SESSION_SECRET']) if (!process.env[key]) throw new Error(`${key} is required`);
const port = Number(process.env.PORT || 8080);
const host = '0.0.0.0';

console.log('[account-server] startup', {
  host,
  port,
  node: process.version,
  cwd: process.cwd(),
  databasePath: process.env.DATABASE_PATH || '(default ./data/ashen-abyss.sqlite)',
});

const server = createApi();
server.on('error', error => logFatal('server-error', error));
server.on('close', () => console.warn('[account-server] server closed'));
server.listen(port, host, () => console.log(`Ashen Abyss account server listening on ${host}:${port}`));
