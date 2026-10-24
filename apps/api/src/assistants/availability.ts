export interface WindowInput {
  dayOfWeek: number;
  start: string;
  end: string;
}

export interface WindowMinutes {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export const MAX_WINDOWS_PER_DAY = 4;
export const MAX_WINDOWS_TOTAL = 28;

const TIME = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/;

/** `"08:30"` → 510. `"24:00"` is allowed as an END (midnight). Returns null when malformed. */
export function parseTime(value: string): number | null {
  const match = TIME.exec(value);
  if (!match) return null;
  return match[3] ? 1440 : Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface WindowIssue {
  path: string;
  message: string;
}

/** Validates a full weekly declaration and converts it to minutes (sorted by day, then start). */
export function validateWindows(
  windows: WindowInput[],
): { ok: true; windows: WindowMinutes[] } | { ok: false; issues: WindowIssue[] } {
  const issues: WindowIssue[] = [];
  const parsed: WindowMinutes[] = [];

  if (windows.length > MAX_WINDOWS_TOTAL) {
    issues.push({ path: 'windows', message: `Use at most ${MAX_WINDOWS_TOTAL} time windows` });
  }

  windows.forEach((w, index) => {
    const start = parseTime(w.start);
    const end = parseTime(w.end);
    if (start === null || start === 1440)
      issues.push({ path: `windows.${index}.start`, message: 'Use a 24-hour time such as 08:30' });
    if (end === null)
      issues.push({ path: `windows.${index}.end`, message: 'Use a 24-hour time such as 17:00' });
    if (start !== null && end !== null && start < 1440 && start >= end) {
      issues.push({ path: `windows.${index}.end`, message: 'The end must be after the start' });
    }
    if (start !== null && end !== null && start < end && start < 1440) {
      parsed.push({ dayOfWeek: w.dayOfWeek, startMinute: start, endMinute: end });
    }
  });

  for (let day = 0; day <= 6; day++) {
    const forDay = parsed
      .filter((w) => w.dayOfWeek === day)
      .toSorted((a, b) => a.startMinute - b.startMinute);
    if (forDay.length > MAX_WINDOWS_PER_DAY) {
      issues.push({
        path: 'windows',
        message: `Use at most ${MAX_WINDOWS_PER_DAY} windows per day`,
      });
    }
    for (let i = 1; i < forDay.length; i++) {
      if ((forDay[i] as WindowMinutes).startMinute < (forDay[i - 1] as WindowMinutes).endMinute) {
        issues.push({ path: 'windows', message: 'Time windows on the same day must not overlap' });
        break;
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    windows: parsed.toSorted((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute),
  };
}
