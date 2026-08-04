const CSRF_COOKIE = 'iptvmaster_csrf';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function installApiSecurity(): void {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : undefined;
    const requestUrl = request
      ? request.url
      : input instanceof URL
        ? input.href
        : String(input);
    const url = new URL(requestUrl, window.location.href);
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = new Headers(request?.headers);
    new Headers(init.headers).forEach((value, name) =>
      headers.set(name, value),
    );

    if (
      url.origin === window.location.origin &&
      url.pathname.startsWith('/api/') &&
      UNSAFE_METHODS.has(method)
    ) {
      const csrfToken = readCookie(CSRF_COOKIE);
      if (csrfToken) headers.set('x-iptvmaster-csrf', csrfToken);
    }

    const response = await nativeFetch(input, {
      ...init,
      method,
      headers,
      credentials: init.credentials ?? 'same-origin',
    });
    if (response.status === 401 && !url.pathname.startsWith('/api/v1/auth/')) {
      window.dispatchEvent(new Event('iptvmaster:authentication-required'));
    }
    return response;
  };
}
