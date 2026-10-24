import type { HudColorName, HudColorValue, HudColorOverrides, UsageValueMode } from '../config.js';
import { isPaceAlert, type UsagePace } from '../usage-pace.js';

export const RESET = '\x1b[0m';

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BRIGHT_BLUE = '\x1b[94m';
const BRIGHT_MAGENTA = '\x1b[95m';
const CLAUDE_ORANGE = '\x1b[38;5;208m';

const ANSI_BY_NAME: Record<HudColorName, string> = {
  dim: DIM,
  red: RED,
  green: GREEN,
  yellow: YELLOW,
  magenta: MAGENTA,
  cyan: CYAN,
  brightBlue: BRIGHT_BLUE,
  brightMagenta: BRIGHT_MAGENTA,
};

/** Convert a hex color string (#rrggbb) to a truecolor ANSI escape sequence. */
function hexToAnsi(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Resolve a color value to an ANSI escape sequence.
 * Accepts named presets, 256-color indices (0-255), or hex strings (#rrggbb).
 */
function resolveAnsi(value: HudColorValue | undefined, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'number') {
    return `\x1b[38;5;${value}m`;
  }
  if (typeof value === 'string' && value.startsWith('#') && value.length === 7) {
    return hexToAnsi(value);
  }
  return ANSI_BY_NAME[value as HudColorName] ?? fallback;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function withOverride(text: string, value: HudColorValue | undefined, fallback: string): string {
  return colorize(text, resolveAnsi(value, fallback));
}

export function green(text: string): string {
  return colorize(text, GREEN);
}

export function yellow(text: string): string {
  return colorize(text, YELLOW);
}

export function red(text: string): string {
  return colorize(text, RED);
}

export function cyan(text: string): string {
  return colorize(text, CYAN);
}

export function magenta(text: string): string {
  return colorize(text, MAGENTA);
}

export function dim(text: string): string {
  return colorize(text, DIM);
}

export function model(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.model, CYAN);
}

export function project(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.project, YELLOW);
}

export function git(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.git, MAGENTA);
}

export function gitBranch(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.gitBranch, CYAN);
}

export function label(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.label, DIM);
}

export function custom(text: string, colors?: Partial<HudColorOverrides>): string {
  return withOverride(text, colors?.custom, CLAUDE_ORANGE);
}

type Rgb = [number, number, number];

// Effort ramps from gray at low to a bold pink→orange→gold gradient at max.
const EFFORT_RGB: Record<string, Rgb> = {
  low: [108, 108, 108],
  medium: [138, 155, 176],
  high: [95, 175, 230],
  xhigh: [175, 135, 255],
};
const EFFORT_GRADIENT: Rgb[] = [[255, 95, 215], [255, 135, 95], [255, 215, 95]];
const BOLD = '\x1b[1m';

const rgbAnsi = ([r, g, b]: Rgb): string => `\x1b[38;2;${r};${g};${b}m`;
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Rgb;

function gradient(text: string, stops: Rgb[]): string {
  const chars = [...text];
  return chars.map((ch, i) => {
    const pos = chars.length > 1 ? (i / (chars.length - 1)) * (stops.length - 1) : 0;
    const idx = Math.min(Math.floor(pos), stops.length - 2);
    return `${rgbAnsi(lerp(stops[idx], stops[idx + 1], pos - idx))}${ch}`;
  }).join('');
}

/** Colors effort text by its level; max and ultracode get the gradient, unknown levels dim. */
export function effortLevel(text: string, level: string): string {
  if (level === 'max' || level.startsWith('ultracode(')) return `${BOLD}${gradient(text, EFFORT_GRADIENT)}${RESET}`;
  const rgb = EFFORT_RGB[level];
  if (!rgb) return dim(text);
  return colorize(text, `${level === 'xhigh' ? BOLD : ''}${rgbAnsi(rgb)}`);
}

export function warning(text: string, colors?: Partial<HudColorOverrides>): string {
  return colorize(text, resolveAnsi(colors?.warning, YELLOW));
}

export function critical(text: string, colors?: Partial<HudColorOverrides>): string {
  return colorize(text, resolveAnsi(colors?.critical, RED));
}

interface ContextThresholds {
  warning?: number;
  critical?: number;
}

export function getContextColor(
  percent: number,
  colors?: Partial<HudColorOverrides>,
  thresholds?: ContextThresholds,
): string {
  const critical = thresholds?.critical ?? 85;
  const warning = thresholds?.warning ?? 70;
  if (percent >= critical) return resolveAnsi(colors?.critical, RED);
  if (percent >= warning) return resolveAnsi(colors?.warning, YELLOW);
  return resolveAnsi(colors?.context, GREEN);
}

/**
 * Usage-window colour: the more severe of the used-percentage band and the
 * consumption pace (when pace is given).
 */
export function getQuotaColor(
  percent: number,
  colors?: Partial<HudColorOverrides>,
  pace: UsagePace | null = null,
): string {
  if (percent >= 90 || pace === 'critical') return resolveAnsi(colors?.critical, RED);
  if (percent >= 75 || pace === 'warning') return resolveAnsi(colors?.usageWarning, BRIGHT_MAGENTA);
  return resolveAnsi(colors?.usage, BRIGHT_BLUE);
}

/**
 * A usage window's percentage (or remaining percentage) in its quota colour,
 * followed by a ▲ in the pace colour when pace is amber/red.
 */
export function formatQuotaPercent(
  percent: number | null,
  colors?: Partial<HudColorOverrides>,
  mode: UsageValueMode = 'percent',
  pace: UsagePace | null = null,
): string {
  if (percent === null) {
    return label('--', colors);
  }
  const color = getQuotaColor(percent, colors, pace);
  const displayPercent = mode === 'remaining' ? Math.max(0, 100 - percent) : percent;
  // The marker takes the pace's own colour, which the percent band may outrank.
  const marker = isPaceAlert(pace) ? ` ${colorize('▲', getQuotaColor(0, colors, pace))}` : '';
  return `${color}${displayPercent}%${RESET}${marker}`;
}

export function quotaBar(
  percent: number,
  width: number = 10,
  colors?: Partial<HudColorOverrides>,
  pace: UsagePace | null = null,
): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  const empty = safeWidth - filled;
  const color = getQuotaColor(safePercent, colors, pace);
  const filledChar = colors?.barFilled ?? '█';
  const emptyChar = colors?.barEmpty ?? '░';
  return `${color}${filledChar.repeat(filled)}${DIM}${emptyChar.repeat(empty)}${RESET}`;
}

export function coloredBar(
  percent: number,
  width: number = 10,
  colors?: Partial<HudColorOverrides>,
  thresholds?: ContextThresholds,
): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  const empty = safeWidth - filled;
  const color = getContextColor(safePercent, colors, thresholds);
  const filledChar = colors?.barFilled ?? '█';
  const emptyChar = colors?.barEmpty ?? '░';
  return `${color}${filledChar.repeat(filled)}${DIM}${emptyChar.repeat(empty)}${RESET}`;
}
