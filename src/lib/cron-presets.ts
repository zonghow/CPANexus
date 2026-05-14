export type CronSimpleSchedule =
  | { mode: "interval"; everyMinutes: number }
  | { mode: "hourly"; minute: number }
  | { mode: "daily"; time: string }
  | { mode: "weekly"; dayOfWeek: number; time: string }
  | { mode: "advanced"; cron: string };

export type CronSimpleMode = CronSimpleSchedule["mode"];

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

export function cronToSimpleSchedule(cron: string): CronSimpleSchedule {
  const trimmed = cron.trim();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return { mode: "advanced", cron: trimmed };
  }

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = fields;
  if (dayOfMonthField !== "*" || monthField !== "*") {
    return { mode: "advanced", cron: trimmed };
  }

  if (hourField === "*" && dayOfWeekField === "*") {
    const everyMinutes = parseMinuteInterval(minuteField);
    if (everyMinutes !== null) {
      return { mode: "interval", everyMinutes };
    }

    const minute = parseIntegerField(minuteField, 0, 59);
    if (minute !== null) {
      return { mode: "hourly", minute };
    }
  }

  const minute = parseIntegerField(minuteField, 0, 59);
  const hour = parseIntegerField(hourField, 0, 23);
  if (minute === null || hour === null) {
    return { mode: "advanced", cron: trimmed };
  }

  const time = formatTime(hour, minute);
  if (dayOfWeekField === "*") {
    return { mode: "daily", time };
  }

  const dayOfWeek = parseIntegerField(dayOfWeekField, 0, 7);
  if (dayOfWeek !== null) {
    return { mode: "weekly", dayOfWeek: dayOfWeek === 7 ? 0 : dayOfWeek, time };
  }

  return { mode: "advanced", cron: trimmed };
}

export function simpleScheduleToCron(schedule: CronSimpleSchedule): string {
  switch (schedule.mode) {
    case "interval": {
      const everyMinutes = normalizeInteger(schedule.everyMinutes, 1, 59, 10);
      return everyMinutes === 1 ? "* * * * *" : `*/${everyMinutes} * * * *`;
    }
    case "hourly": {
      const minute = normalizeInteger(schedule.minute, 0, 59, 0);
      return `${minute} * * * *`;
    }
    case "daily": {
      const { hour, minute } = parseTime(schedule.time) ?? { hour: 0, minute: 0 };
      return `${minute} ${hour} * * *`;
    }
    case "weekly": {
      const { hour, minute } = parseTime(schedule.time) ?? { hour: 0, minute: 0 };
      const dayOfWeek = normalizeInteger(schedule.dayOfWeek, 0, 6, 1);
      return `${minute} ${hour} * * ${dayOfWeek}`;
    }
    case "advanced":
      return schedule.cron.trim();
    default:
      return exhaustiveCheck(schedule);
  }
}

export function describeSimpleSchedule(schedule: CronSimpleSchedule): string {
  switch (schedule.mode) {
    case "interval":
      return `每 ${normalizeInteger(schedule.everyMinutes, 1, 59, 10)} 分钟执行一次`;
    case "hourly":
      return `每小时第 ${normalizeInteger(schedule.minute, 0, 59, 0)} 分钟执行`;
    case "daily":
      return `每天 ${normalizeTime(schedule.time)} 执行`;
    case "weekly":
      return `每周${weekdays[normalizeInteger(schedule.dayOfWeek, 0, 6, 1)]} ${normalizeTime(schedule.time)} 执行`;
    case "advanced":
      return `高级 Cron：${schedule.cron.trim() || "-"}`;
    default:
      return exhaustiveCheck(schedule);
  }
}

function parseMinuteInterval(field: string) {
  if (field === "*" || field === "*/1") {
    return 1;
  }

  const match = field.match(/^\*\/(\d+)$/);
  if (!match) {
    return null;
  }

  return normalizeParsedInteger(Number(match[1]), 1, 59);
}

function parseIntegerField(field: string, min: number, max: number) {
  if (!/^\d+$/.test(field)) {
    return null;
  }

  return normalizeParsedInteger(Number(field), min, max);
}

function normalizeParsedInteger(value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }

  return value;
}

function normalizeInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }

  return value;
}

function parseTime(time: string) {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = normalizeParsedInteger(Number(match[1]), 0, 23);
  const minute = normalizeParsedInteger(Number(match[2]), 0, 59);
  if (hour === null || minute === null) {
    return null;
  }

  return { hour, minute };
}

function normalizeTime(time: string) {
  const parsed = parseTime(time);
  return parsed ? formatTime(parsed.hour, parsed.minute) : "00:00";
}

function formatTime(hour: number, minute: number) {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function exhaustiveCheck(value: never): never {
  throw new Error(`Unhandled schedule mode: ${JSON.stringify(value)}`);
}
