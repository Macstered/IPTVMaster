import { useEffect, useState } from 'react';

interface ChannelLogoProps {
  /**
   * Same-origin logo endpoint for this channel, or undefined when the channel
   * has no logo. Provider URLs are never used directly: the server resolves
   * and fetches them so the browser cannot be steered at an arbitrary host by
   * a provider feed.
   */
  src?: string;
  name: string;
}

function fallbackLetter(name: string): string {
  const cleaned = name.replace(/^[A-Z]{2,3}:\s*/u, '').trim();
  return (cleaned[0] ?? '?').toLocaleUpperCase();
}

export function channelLogoSource(
  sourceId: string | undefined,
  channelId: string,
  hasLogo: boolean,
): string | undefined {
  if (!sourceId || !hasLogo) return undefined;
  return `/api/v1/sources/${sourceId}/channels/${channelId}/logo`;
}

export function guideLogoSource(
  epgSourceId: string | undefined,
  channelId: string,
  hasLogo: boolean,
): string | undefined {
  if (!epgSourceId || !hasLogo) return undefined;
  return `/api/v1/epg-sources/${epgSourceId}/logo?channelId=${encodeURIComponent(channelId)}`;
}

/**
 * Small channel logo thumbnail with a letter fallback when the channel has no
 * logo or the server could not retrieve a usable image.
 */
export function ChannelLogo({ src, name }: ChannelLogoProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (!src || failed) {
    return (
      <span className="channel-logo fallback" aria-hidden="true">
        {fallbackLetter(name)}
      </span>
    );
  }
  return (
    <span className="channel-logo" aria-hidden="true">
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}
