/**
 * Uniform rate-limit error detection, parsing, and formatting across providers
 * (Anthropic, OpenAI, Google Gemini, DeepSeek, Groq, Mistral, OpenRouter, etc.).
 */

export interface RateLimitInfo {
  /** True when the error represents an API rate limit or quota exhaustion. */
  isRateLimit: boolean;
  /** Epoch timestamp in ms when the rate limit is expected to be resolved. */
  resetsAt: number;
  /** Human-readable relative time (e.g. "in 45s", "in 1m 30s", "now"). */
  relative: string;
  /** Human-readable absolute local time (e.g. "15:42:30"). */
  absolute: string;
  /** Uniform user-facing message across all providers. */
  message: string;
  /** The original raw provider error message. */
  rawError?: string;
}

/** Format milliseconds remaining into a concise relative string (e.g. "in 45s", "in 1m 30s"). */
export function formatRelativeTime(msUntilReset: number): string {
  const totalSec = Math.ceil(msUntilReset / 1000);
  if (totalSec <= 0) return "now";
  if (totalSec < 60) return `in ${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) {
    return secs > 0 ? `in ${mins}m ${secs}s` : `in ${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
}

/** Format an absolute epoch timestamp into HH:mm:ss (or YYYY-MM-DD HH:mm:ss if on a different day). */
export function formatAbsoluteTime(timestamp: number): string {
  const target = new Date(timestamp);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timeStr = `${pad(target.getHours())}:${pad(target.getMinutes())}:${pad(target.getSeconds())}`;

  // Check if same calendar day
  const isSameDay =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();

  if (isSameDay) return timeStr;
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${timeStr}`;
}

/** Construct the uniform user-facing rate limit message. */
export function formatRateLimitUniformMessage(resetsAt: number, now = Date.now()): string {
  const remainingMs = Math.max(0, resetsAt - now);
  const relative = formatRelativeTime(remainingMs);
  const absolute = formatAbsoluteTime(resetsAt);
  return `Rate limit reached. Resets ${relative} (at ${absolute}).`;
}

/**
 * Parses any provider error string or object to determine if it is a rate limit,
 * extracting the reset duration or timestamp when available.
 */
export function parseRateLimit(errorInput: unknown, now = Date.now()): RateLimitInfo | null {
  if (!errorInput) return null;

  const errorText =
    typeof errorInput === "string"
      ? errorInput
      : typeof errorInput === "object" && errorInput !== null && "message" in errorInput
        ? String((errorInput as { message?: unknown }).message)
        : String(errorInput);

  if (!errorText || errorText === "undefined" || errorText === "null") return null;

  // Broad rate limit indicator regex covering Anthropic, OpenAI, Gemini, Groq, DeepSeek, etc.
  const isRateLimit =
    /rate.?limit|too many requests|\b429\b|resource.?exhausted|ResourceExhausted|quota.?exceeded|insufficient_quota|tokens per (?:min|minute)|requests per (?:min|minute)|\btpm\b|\brpm\b|\btpd\b|\brpd\b|retry.?(?:after|in)|try again in/i.test(
      errorText,
    );

  if (!isRateLimit) return null;

  let durationMs = 0;
  let resetsAt = 0;

  // 1. Try ISO timestamp / date: "resets at 2026-09-24T15:30:00Z" or "resets at 2026-09-24 15:30:00"
  const dateMatch = errorText.match(
    /resets?\s+(?:at|on)\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[T\s][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?)/i,
  );
  if (dateMatch && dateMatch[1]) {
    const parsed = Date.parse(dateMatch[1]);
    if (!isNaN(parsed) && parsed > 0) {
      resetsAt = parsed;
      durationMs = Math.max(0, resetsAt - now);
    }
  }

  // 2. Try epoch timestamp: "resets at 1758728400"
  if (!resetsAt) {
    const epochMatch = errorText.match(/resets?\s+(?:at|epoch)\s+(\d{10,13})/i);
    if (epochMatch) {
      let val = Number(epochMatch[1]);
      if (val < 1e11) val *= 1000;
      if (val > now) {
        resetsAt = val;
        durationMs = Math.max(0, resetsAt - now);
      }
    }
  }

  // 3. Try compound durations: "in 1h 30m", "in 1m30s", "in 1 min 30 sec", "in 45s", "in 45.5s", "in 45 seconds", "in 2 minutes"
  if (!resetsAt) {
    const complexMatch = errorText.match(
      /(?:try again in|retry (?:after|in)|resets? in|wait)\s+(?:about\s+)?(?:(\d+)\s*(?:hours?|hrs?|h))?\s*(?:(\d+)\s*(?:minutes?|mins?|m))?\s*(?:(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s))?/i,
    );
    if (complexMatch && (complexMatch[1] || complexMatch[2] || complexMatch[3])) {
      const hours = Number(complexMatch[1] || 0);
      const mins = Number(complexMatch[2] || 0);
      const secs = Number(complexMatch[3] || 0);
      durationMs = (hours * 3600 + mins * 60 + secs) * 1000;
    } else {
      // Direct "retry-after: 45" or "retry_after=45"
      const retryAfterMatch = errorText.match(/retry[-_]after[:=\s]+(\d+(?:\.\d+)?)\s*(s|sec|ms)?/i);
      if (retryAfterMatch) {
        const val = Number(retryAfterMatch[1]);
        const unit = retryAfterMatch[2]?.toLowerCase();
        durationMs = unit === "ms" ? val : val * 1000;
      }
    }
  }

  // Fallback: if rate limit detected but no duration was extractable, default to 60s
  if (!durationMs && !resetsAt) {
    durationMs = 60_000;
  }

  if (!resetsAt) {
    resetsAt = now + durationMs;
  }

  const remainingMs = Math.max(0, resetsAt - now);
  const relative = formatRelativeTime(remainingMs);
  const absolute = formatAbsoluteTime(resetsAt);
  const message = `Rate limit reached. Resets ${relative} (at ${absolute}).`;

  return {
    isRateLimit: true,
    resetsAt,
    relative,
    absolute,
    message,
    rawError: errorText,
  };
}
