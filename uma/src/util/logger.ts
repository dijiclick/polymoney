const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function log(level: LogLevel, module: string, msg: string, data?: any): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}] [${module}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, data);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

const seenOnce = new Set<string>();

export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: any) => log('debug', module, msg, data),
    info: (msg: string, data?: any) => log('info', module, msg, data),
    warn: (msg: string, data?: any) => log('warn', module, msg, data),
    error: (msg: string, data?: any) => log('error', module, msg, data),
    warnOnce: (key: string, msg: string, data?: any) => {
      if (seenOnce.has(key)) return;
      seenOnce.add(key);
      log('warn', module, msg, data);
    },
    clearOnce: (key: string) => { seenOnce.delete(key); },
  };
}
