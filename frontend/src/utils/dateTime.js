export const INDIA_TIME_ZONE = "Asia/Kolkata";

export function formatIndiaDateTime(value, options = {}) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const { dateStyle, timeStyle, ...componentOptions } = options;
  const formatOptions = dateStyle || timeStyle
    ? { ...(dateStyle ? { dateStyle } : {}), ...(timeStyle ? { timeStyle } : {}) }
    : {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        ...componentOptions,
      };
  return new Intl.DateTimeFormat("en-IN", {
    ...formatOptions,
    timeZone: INDIA_TIME_ZONE,
  }).format(date) + " IST";
}

export function toIndiaDateTimeInput(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`;
}

export function parseIndiaDateTimeInput(value) {
  return new Date(`${value}:00+05:30`);
}
