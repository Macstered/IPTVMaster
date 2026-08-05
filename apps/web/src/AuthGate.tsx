import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { App } from './App.js';
import { IconPlay } from './icons.js';

interface AuthStatus {
  enabled: boolean;
  setupRequired: boolean;
  authenticated: boolean;
  username?: string;
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? `Request failed (${response.status})`;
}

export function AuthGate() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/auth/status');
      if (!response.ok) throw new Error(await readError(response));
      setStatus((await response.json()) as AuthStatus);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not check administrator access',
      );
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const requireAuthentication = () => void loadStatus();
    window.addEventListener(
      'iptvmaster:authentication-required',
      requireAuthentication,
    );
    return () =>
      window.removeEventListener(
        'iptvmaster:authentication-required',
        requireAuthentication,
      );
  }, [loadStatus]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!status) return;
    if (status.setupRequired && password !== confirmation) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        status.setupRequired ? '/api/v1/auth/setup' : '/api/v1/auth/login',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      setStatus((await response.json()) as AuthStatus);
      setPassword('');
      setConfirmation('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed');
      setPassword('');
      setConfirmation('');
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error(await readError(response));
      setStatus((current) =>
        current
          ? { ...current, authenticated: false, username: undefined }
          : current,
      );
      setPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-out failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (status?.authenticated) {
    return (
      <App
        authUsername={status.enabled ? status.username : undefined}
        onLogout={status.enabled ? () => void logout() : undefined}
      />
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-busy={status === null || submitting}>
        <div className="auth-brand">
          <span className="brand-mark">
            <IconPlay width={18} height={18} />
          </span>
          <div>
            <strong>IPTVMaster</strong>
            <small>Local playlist control</small>
          </div>
        </div>
        {status === null ? (
          <>
            <p className="eyebrow">SECURE LOCAL ACCESS</p>
            <h1>Checking administrator access</h1>
            <p className="panel-copy">Connecting to the local service…</p>
            {error ? (
              <button type="button" onClick={() => void loadStatus()}>
                Try again
              </button>
            ) : null}
          </>
        ) : (
          <>
            <p className="eyebrow">
              {status.setupRequired
                ? 'FIRST-RUN SETUP'
                : 'ADMINISTRATOR SIGN-IN'}
            </p>
            <h1>
              {status.setupRequired
                ? 'Create your local administrator'
                : 'Welcome back'}
            </h1>
            <p className="panel-copy">
              {status.setupRequired
                ? 'This is the only administrator account. Choose a unique password and keep it with your local deployment records.'
                : 'Sign in to edit sources, channels, events, and EPG mappings.'}
            </p>
            <form onSubmit={submit}>
              <label htmlFor="administrator-username">Username</label>
              <input
                id="administrator-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9._-]+"
                required
                autoFocus
              />
              <label htmlFor="administrator-password">Password</label>
              <input
                id="administrator-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  status.setupRequired ? 'new-password' : 'current-password'
                }
                minLength={status.setupRequired ? 12 : 1}
                maxLength={128}
                required
              />
              {status.setupRequired ? (
                <>
                  <label htmlFor="administrator-password-confirmation">
                    Confirm password
                  </label>
                  <input
                    id="administrator-password-confirmation"
                    type="password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </>
              ) : null}
              <button type="submit" disabled={submitting}>
                {submitting
                  ? 'Please wait…'
                  : status.setupRequired
                    ? 'Create administrator'
                    : 'Sign in'}
              </button>
            </form>
          </>
        )}
        {error ? <p className="message error">{error}</p> : null}
      </section>
    </main>
  );
}
