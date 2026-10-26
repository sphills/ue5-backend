// Tiny JSON-lines logger (one object per line, ready for any log shipper).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger({ level = 'info', base = {}, write = (line) => process.stdout.write(line + '\n') } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function log(lvl, fields, msg) {
    if (LEVELS[lvl] < threshold) return;
    if (typeof fields === 'string') [fields, msg] = [{}, fields];
    const entry = { time: new Date().toISOString(), level: lvl, ...base, ...fields, msg };
    if (fields?.err instanceof Error) {
      entry.err = { message: fields.err.message, code: fields.err.code, stack: fields.err.stack };
    }
    write(JSON.stringify(entry));
  }

  return {
    debug: (f, m) => log('debug', f, m),
    info: (f, m) => log('info', f, m),
    warn: (f, m) => log('warn', f, m),
    error: (f, m) => log('error', f, m),
    child: (extra) => createLogger({ level, base: { ...base, ...extra }, write }),
  };
}
