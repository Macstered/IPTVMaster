export type MediaType = 'live' | 'vod' | 'series' | 'unknown';

export interface M3uEntry {
  duration: number | null;
  attributes: Record<string, string>;
  name: string;
  url: string;
  mediaType: MediaType;
  lineNumber: number;
}

export interface M3uParseIssue {
  lineNumber: number;
  code: 'missing-url' | 'orphan-url' | 'invalid-extinf';
  message: string;
}

export interface M3uParseResult {
  entries: M3uEntry[];
  issues: M3uParseIssue[];
  mediaCounts: Record<MediaType, number>;
  skippedEntries: number;
}

export interface M3uParseOptions {
  includeMediaTypes?: readonly MediaType[];
  maxRetainedEntries?: number;
}

export type NumericDateOrder = 'month-day' | 'day-month';

export interface EventTimePolicy {
  sourceTimeZone: string;
  displayTimeZone: string;
  numericDateOrder?: NumericDateOrder;
  referenceDate: string;
}

export interface EventTimeLocalization {
  originalName: string;
  localizedName: string;
  changed: boolean;
  status: 'localized' | 'no-time' | 'invalid-time' | 'invalid-timezone';
  sourceDateTime?: string;
  displayDateTime?: string;
  crossedDateBoundary: boolean;
  warning?: string;
}

export interface EventGroupPolicy {
  groupName: string;
  outputGroupName?: string;
  enabled: boolean;
  hidePlaceholders: boolean;
  placeholderPatterns?: string[];
  timePolicy?: EventTimePolicy;
}

export interface AppliedEventPolicy {
  entry: M3uEntry;
  hidden: boolean;
  hideReason?: string;
  time: EventTimeLocalization;
}
