import { useRef } from 'react';

import { showToast } from '../toast.js';

interface CopyFieldProps {
  id: string;
  label: string;
  value: string;
}

/** A read-only value with a Copy button that also works over plain HTTP. */
export function CopyField({ id, label, value }: CopyFieldProps) {
  const input = useRef<HTMLInputElement | null>(null);

  async function copy() {
    let copied = false;
    try {
      // The async clipboard only exists on HTTPS and localhost, and this app
      // is usually opened over plain HTTP on a home network.
      if (window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        copied = true;
      } else if (input.current) {
        input.current.select();
        copied = document.execCommand('copy');
      }
    } catch {
      copied = false;
    }
    showToast(
      copied ? 'success' : 'error',
      copied ? `${label} copied` : 'Could not copy — select the text instead',
    );
  }

  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <div className="ui-copy">
        <input
          id={id}
          ref={input}
          className="ui-input mono"
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button className="ui-button" type="button" onClick={() => void copy()}>
          Copy
        </button>
      </div>
    </div>
  );
}
