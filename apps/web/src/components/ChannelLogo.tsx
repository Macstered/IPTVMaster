import { useEffect, useState } from 'react';

interface ChannelLogoProps {
  url: string | undefined;
  name: string;
}

const PRIVATE_HOST =
  /^localhost$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^\[?::1\]?$|^\[?f[cde]|\.local$/i;

/**
 * Provider feeds supply logo URLs, so the browser would otherwise issue a
 * request to any address the provider chooses — including devices on the
 * operator's own network. Only public HTTP(S) URLs are rendered.
 */
function isDisplayableLogoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return !PRIVATE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function fallbackLetter(name: string): string {
  const cleaned = name.replace(/^[A-Z]{2,3}:\s*/u, '').trim();
  return (cleaned[0] ?? '?').toLocaleUpperCase();
}

/**
 * Small channel logo thumbnail with a letter fallback when the provider ships
 * no logo or the image fails to load.
 */
export function ChannelLogo({ url, name }: ChannelLogoProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  if (!url || failed || !isDisplayableLogoUrl(url)) {
    return (
      <span className="channel-logo fallback" aria-hidden="true">
        {fallbackLetter(name)}
      </span>
    );
  }
  return (
    <span className="channel-logo" aria-hidden="true">
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
