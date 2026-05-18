type CronField = {
  any: boolean;
  values: Set<number>;
};

type CronSchedule = {
  hasSeconds: boolean;
  seconds: CronField;
  minutes: CronField;
  hours: CronField;
  daysOfMonth: CronField;
  months: CronField;
  daysOfWeek: CronField;
};

const minuteMs = 60_000;
const secondMs = 1_000;

export function nextCronRunAfter(expression: string, from = new Date()) {
  const schedule = parseCronExpression(expression);
  if (!schedule) {
    return null;
  }

  const stepMs = schedule.hasSeconds ? secondMs : minuteMs;
  const maxSteps = schedule.hasSeconds ? 7 * 24 * 60 * 60 : 366 * 24 * 60;
  let candidate = new Date(Math.floor(from.getTime() / stepMs) * stepMs + stepMs);
  candidate.setMilliseconds(0);
  if (!schedule.hasSeconds) {
    candidate.setSeconds(0);
  }

  for (let step = 0; step < maxSteps; step += 1) {
    if (matchesSchedule(candidate, schedule)) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + stepMs);
  }

  return null;
}

export function nextCronRunAfterLastRun(
  expression: string,
  lastRunAt: string | Date | null | undefined,
  from = new Date(),
) {
  const intervalMs = minuteIntervalMsFromCron(expression);
  const lastRun = parseDate(lastRunAt);
  if (!intervalMs || !lastRun) {
    return nextCronRunAfter(expression, from);
  }

  let nextRunTime = lastRun.getTime() + intervalMs;
  const fromTime = from.getTime();
  if (nextRunTime <= fromTime) {
    const missedIntervals = Math.floor((fromTime - nextRunTime) / intervalMs) + 1;
    nextRunTime += missedIntervals * intervalMs;
  }

  return new Date(nextRunTime);
}

export function secondsUntilCronRun(expression: string, from = new Date()) {
  const nextRunAt = nextCronRunAfter(expression, from);
  if (!nextRunAt) {
    return null;
  }

  return Math.max(0, Math.ceil((nextRunAt.getTime() - from.getTime()) / 1000));
}

export function minuteIntervalMsFromCron(expression: string) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = fields;
  if (hours !== "*" || daysOfMonth !== "*" || months !== "*" || daysOfWeek !== "*") {
    return null;
  }

  if (minutes === "*" || minutes === "*/1") {
    return minuteMs;
  }

  const match = minutes.match(/^\*\/(\d+)$/);
  if (!match) {
    return null;
  }

  const everyMinutes = Number(match[1]);
  return Number.isInteger(everyMinutes) && everyMinutes >= 1 && everyMinutes <= 59
    ? everyMinutes * minuteMs
    : null;
}

function parseDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseCronExpression(expression: string): CronSchedule | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    return null;
  }

  const hasSeconds = fields.length === 6;
  const [seconds, minutes, hours, daysOfMonth, months, daysOfWeek] = hasSeconds
    ? fields
    : ["0", ...fields];

  const parsed = {
    hasSeconds,
    seconds: parseCronField(seconds, 0, 59),
    minutes: parseCronField(minutes, 0, 59),
    hours: parseCronField(hours, 0, 23),
    daysOfMonth: parseCronField(daysOfMonth, 1, 31),
    months: parseCronField(months, 1, 12),
    daysOfWeek: parseCronField(daysOfWeek, 0, 7, (value) => (value === 7 ? 0 : value)),
  };

  return Object.values(parsed).some((field) => field === null)
    ? null
    : (parsed as CronSchedule);
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  normalize: (value: number) => number = (value) => value,
): CronField | null {
  const values = new Set<number>();
  const parts = field.split(",");
  let any = false;

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      return null;
    }

    const [rangePart, stepPart] = part.split("/");
    if (part.split("/").length > 2) {
      return null;
    }

    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) {
      return null;
    }

    const range = parseRange(rangePart, min, max);
    if (!range) {
      return null;
    }

    any ||= range.any && step === 1;
    for (let value = range.start; value <= range.end; value += step) {
      const normalized = normalize(value);
      if (normalized < min || normalized > max) {
        return null;
      }
      values.add(normalized);
    }
  }

  return { any, values };
}

function parseRange(range: string, min: number, max: number) {
  if (range === "*") {
    return { start: min, end: max, any: true };
  }

  if (range.includes("-")) {
    const [start, end] = range.split("-").map(Number);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      return null;
    }
    return { start, end, any: false };
  }

  const value = Number(range);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }

  return { start: value, end: value, any: false };
}

function matchesSchedule(date: Date, schedule: CronSchedule) {
  if (!schedule.seconds.values.has(date.getSeconds())) {
    return false;
  }
  if (!schedule.minutes.values.has(date.getMinutes())) {
    return false;
  }
  if (!schedule.hours.values.has(date.getHours())) {
    return false;
  }
  if (!schedule.months.values.has(date.getMonth() + 1)) {
    return false;
  }

  const dayOfMonthMatches = schedule.daysOfMonth.values.has(date.getDate());
  const dayOfWeekMatches = schedule.daysOfWeek.values.has(date.getDay());
  if (schedule.daysOfMonth.any && schedule.daysOfWeek.any) {
    return true;
  }
  if (schedule.daysOfMonth.any) {
    return dayOfWeekMatches;
  }
  if (schedule.daysOfWeek.any) {
    return dayOfMonthMatches;
  }

  return dayOfMonthMatches || dayOfWeekMatches;
}
