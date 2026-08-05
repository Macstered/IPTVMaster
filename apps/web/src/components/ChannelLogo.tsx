import { useEffect, useState } from 'react';

interface ChannelLogoProps {
  url: string | undefined;
  name: string;
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
  if (!url || failed) {
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
