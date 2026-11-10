export interface SourceSyncStatus {
  status: 'succeeded' | 'failed' | 'rejected';
  finishedAt: string;
  error?: string;
}

export interface SourceStatus {
  sourceId: string;
  name: string;
  enabled: boolean;
  channelCount: number;
  visibleChannelCount: number;
  groupCount: number;
  reviewPending: number;
  epgMappable: number;
  epgMapped: number;
  epgExcluded: number;
  lastPlaylistSync?: SourceSyncStatus;
  lastEpgSync?: SourceSyncStatus;
}

export interface SystemStatus {
  sources: SourceStatus[];
  outputProfileCount: number;
  automation: {
    playlist: { enabled: boolean; intervalMinutes: number };
    epg: { enabled: boolean; intervalMinutes: number };
  };
}

export function relativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
