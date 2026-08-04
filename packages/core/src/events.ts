import { DateTime, IANAZone } from 'luxon';

import type {
  AppliedEventPolicy,
  EventGroupPolicy,
  EventTimeLocalization,
  EventTimePolicy,
  M3uEntry,
  NumericDateOrder,
} from './types.js';

export const DEFAULT_PLACEHOLDER_PATTERNS = [
  'reload your playlist',
  'live during events only',
  'no event streaming',
  'no scheduled event',
  'gmt london timezone',
];

const LEADING_TIME =
  /^(?<hour>[01]?\d|2[0-3])(?<separator>[:.])(?<minute>[0-5]\d)\b/;
const TEXT_DATE_TIME =
  /\b(?<weekday>Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?<day>\d{1,2})\s+(?<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(?<hour>[01]?\d|2[0-3])(?<separator>[:.])(?<minute>[0-5]\d)\b/i;
const NUMERIC_DATE =
  /\b(?<first>\d{1,2})\/(?<second>\d{1,2})(?:\/(?<year>\d{2,4}))?\b/;

function inferYear(month: number, day: number, reference: DateTime): number {
  let year = reference.year;
  const candidate = DateTime.fromObject(
    { year, month, day },
    { zone: reference.zoneName ?? 'UTC' },
  );
  if (!candidate.isValid) return year;

  const difference = candidate.diff(reference, 'days').days;
  if (difference > 183) year -= 1;
  if (difference < -183) year += 1;
  return year;
}

function numericDateParts(
  match: RegExpExecArray | null,
  order: NumericDateOrder,
  reference: DateTime,
): { year: number; month: number; day: number } {
  if (!match?.groups) {
    return { year: reference.year, month: reference.month, day: reference.day };
  }

  const first = Number(match.groups['first']);
  const second = Number(match.groups['second']);
  const month = order === 'month-day' ? first : second;
  const day = order === 'month-day' ? second : first;
  const rawYear = match.groups['year'];
  let year = rawYear ? Number(rawYear) : inferYear(month, day, reference);
  if (rawYear?.length === 2) year += year >= 70 ? 1900 : 2000;
  return { year, month, day };
}

function invalidResult(
  name: string,
  status: EventTimeLocalization['status'],
  warning: string,
): EventTimeLocalization {
  return {
    originalName: name,
    localizedName: name,
    changed: false,
    status,
    crossedDateBoundary: false,
    warning,
  };
}

export function localizeEventName(
  name: string,
  policy: EventTimePolicy,
): EventTimeLocalization {
  if (
    !IANAZone.isValidZone(policy.sourceTimeZone) ||
    !IANAZone.isValidZone(policy.displayTimeZone)
  ) {
    return invalidResult(name, 'invalid-timezone', 'Invalid IANA timezone');
  }

  const reference = DateTime.fromISO(policy.referenceDate, {
    zone: policy.sourceTimeZone,
  }).startOf('day');
  if (!reference.isValid) {
    return invalidResult(name, 'invalid-time', 'Invalid reference date');
  }

  const textMatch = TEXT_DATE_TIME.exec(name);
  const leadingMatch = LEADING_TIME.exec(name);
  if (!textMatch?.groups && !leadingMatch?.groups) {
    return invalidResult(
      name,
      'no-time',
      'No supported event start time found',
    );
  }

  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  let timeStart: number;
  let timeLength: number;
  let separator: string;
  let numericMatch: RegExpExecArray | null = null;

  if (textMatch?.groups) {
    const parsedDate = DateTime.fromFormat(
      `${textMatch.groups['day']} ${textMatch.groups['month']} ${reference.year}`,
      'd LLL yyyy',
      { zone: policy.sourceTimeZone, locale: 'en' },
    );
    year = inferYear(parsedDate.month, parsedDate.day, reference);
    month = parsedDate.month;
    day = parsedDate.day;
    hour = Number(textMatch.groups['hour']);
    minute = Number(textMatch.groups['minute']);
    separator = textMatch.groups['separator'] ?? ':';
    const timeText = `${textMatch.groups['hour']}${separator}${textMatch.groups['minute']}`;
    timeStart = textMatch.index + textMatch[0].lastIndexOf(timeText);
    timeLength = timeText.length;
  } else {
    const groups = leadingMatch?.groups;
    if (!groups || leadingMatch === null) {
      return invalidResult(name, 'invalid-time', 'Could not parse event time');
    }
    numericMatch = NUMERIC_DATE.exec(name);
    const parts = numericDateParts(
      numericMatch,
      policy.numericDateOrder ?? 'month-day',
      reference,
    );
    ({ year, month, day } = parts);
    hour = Number(groups['hour']);
    minute = Number(groups['minute']);
    separator = groups['separator'] ?? ':';
    timeStart = leadingMatch.index;
    timeLength = leadingMatch[0].length;
  }

  const source = DateTime.fromObject(
    { year, month, day, hour, minute },
    { zone: policy.sourceTimeZone },
  );
  if (!source.isValid) {
    return invalidResult(
      name,
      'invalid-time',
      source.invalidExplanation ?? 'Invalid event time',
    );
  }

  const display = source.setZone(policy.displayTimeZone);
  const crossedDateBoundary = source.toISODate() !== display.toISODate();
  const localizedTime = `${display.toFormat('H')}${separator}${display.toFormat('mm')}`;
  let localizedName = `${name.slice(0, timeStart)}${localizedTime}${name.slice(timeStart + timeLength)}`;

  if (numericMatch?.groups && crossedDateBoundary) {
    const order = policy.numericDateOrder ?? 'month-day';
    const includeYear = numericMatch.groups['year'] !== undefined;
    const first = order === 'month-day' ? display.month : display.day;
    const second = order === 'month-day' ? display.day : display.month;
    const yearText = includeYear
      ? `/${numericMatch.groups['year']?.length === 2 ? display.toFormat('yy') : display.year}`
      : '';
    const replacement = `${first}/${second}${yearText}`;
    localizedName = localizedName.replace(numericMatch[0], replacement);
  } else if (textMatch?.groups && crossedDateBoundary) {
    const originalDate = `${textMatch.groups['weekday']} ${textMatch.groups['day']} ${textMatch.groups['month']}`;
    localizedName = localizedName.replace(
      originalDate,
      display.setLocale('en').toFormat('ccc dd LLL'),
    );
  }

  return {
    originalName: name,
    localizedName,
    changed: localizedName !== name,
    status: 'localized',
    sourceDateTime: source.toUTC().toISO() ?? undefined,
    displayDateTime: display.toISO() ?? undefined,
    crossedDateBoundary,
    warning:
      crossedDateBoundary && numericMatch === null && textMatch === null
        ? 'The localized time crosses midnight but the title has no date to update'
        : undefined,
  };
}

function placeholderMatch(
  name: string,
  patterns: readonly string[],
): string | undefined {
  const normalized = name.toLocaleLowerCase('en');
  return patterns.find((pattern) =>
    normalized.includes(pattern.toLocaleLowerCase('en')),
  );
}

export function applyEventGroupPolicy(
  entry: M3uEntry,
  policy: EventGroupPolicy,
): AppliedEventPolicy {
  const patterns = policy.placeholderPatterns ?? DEFAULT_PLACEHOLDER_PATTERNS;
  const matchedPlaceholder = policy.hidePlaceholders
    ? placeholderMatch(entry.name, patterns)
    : undefined;
  const time = policy.timePolicy
    ? localizeEventName(entry.name, policy.timePolicy)
    : invalidResult(entry.name, 'no-time', 'Time localization is disabled');

  const attributes = { ...entry.attributes };
  if (policy.outputGroupName)
    attributes['group-title'] = policy.outputGroupName;
  if (time.changed && attributes['tvg-name'] !== undefined) {
    attributes['tvg-name'] = time.localizedName;
  }

  return {
    entry: {
      ...entry,
      name: time.localizedName,
      attributes,
    },
    hidden: !policy.enabled || matchedPlaceholder !== undefined,
    hideReason: !policy.enabled
      ? 'Event group is disabled'
      : matchedPlaceholder
        ? `Matched placeholder pattern: ${matchedPlaceholder}`
        : undefined,
    time,
  };
}
