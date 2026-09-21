const enabled =
  process.stdout.isTTY &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";

const wrap = (open, close) => (s) =>
  enabled ? `${open}${s}${close}` : String(s);

export const c = {
  reset: enabled ? "\x1b[0m" : "",
  bold: wrap("\x1b[1m", "\x1b[22m"),
  dim: wrap("\x1b[2m", "\x1b[22m"),
  italic: wrap("\x1b[3m", "\x1b[23m"),
  underline: wrap("\x1b[4m", "\x1b[24m"),

  black: wrap("\x1b[30m", "\x1b[39m"),
  red: wrap("\x1b[31m", "\x1b[39m"),
  green: wrap("\x1b[32m", "\x1b[39m"),
  yellow: wrap("\x1b[33m", "\x1b[39m"),
  blue: wrap("\x1b[34m", "\x1b[39m"),
  magenta: wrap("\x1b[35m", "\x1b[39m"),
  cyan: wrap("\x1b[36m", "\x1b[39m"),
  white: wrap("\x1b[37m", "\x1b[39m"),
  gray: wrap("\x1b[90m", "\x1b[39m"),

  brightRed: wrap("\x1b[91m", "\x1b[39m"),
  brightGreen: wrap("\x1b[92m", "\x1b[39m"),
  brightYellow: wrap("\x1b[93m", "\x1b[39m"),
  brightBlue: wrap("\x1b[94m", "\x1b[39m"),
  brightMagenta: wrap("\x1b[95m", "\x1b[39m"),
  brightCyan: wrap("\x1b[96m", "\x1b[39m"),
  brightWhite: wrap("\x1b[97m", "\x1b[39m"),

  bgRed: wrap("\x1b[41m", "\x1b[49m"),
  bgGreen: wrap("\x1b[42m", "\x1b[49m"),
  bgYellow: wrap("\x1b[43m", "\x1b[49m"),
  bgBlue: wrap("\x1b[44m", "\x1b[49m"),
  bgMagenta: wrap("\x1b[45m", "\x1b[49m"),
  bgCyan: wrap("\x1b[46m", "\x1b[49m"),
};

/** Strip ANSI for measuring display width */
export function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleLength(s) {
  return stripAnsi(s).length;
}

export function padEndVisible(s, width) {
  const len = visibleLength(s);
  if (len >= width) return String(s);
  return String(s) + " ".repeat(width - len);
}

const palette = [
  c.brightCyan,
  c.brightMagenta,
  c.brightYellow,
  c.brightGreen,
  c.brightBlue,
  c.magenta,
  c.cyan,
];

/** Deterministic color per model name */
export function modelColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
