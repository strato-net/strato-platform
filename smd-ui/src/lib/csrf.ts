// CSRF handling — nginx-packager sets a CSRF-TOKEN cookie on GET requests and
// expects it echoed back in the X-CSRF-Token header on state-changing calls.

export function getCsrfToken(): string | null {
  const match = document.cookie.match(/CSRF-TOKEN=([^;]+)/);
  return match ? match[1] : null;
}

/** Trigger CSRF token generation by issuing a GET to a protected path. */
export async function initializeCsrfToken(): Promise<void> {
  try {
    await fetch("/strato/v2.3/key", { credentials: "include" }).catch(() => {});
  } catch (error) {
    console.warn("Failed to initialize CSRF token:", error);
  }
}

/** viem Transport onFetchRequest hook that attaches a fresh CSRF token. */
export function csrfOnRequest(_request: Request, init: RequestInit): RequestInit {
  const csrfToken = getCsrfToken();
  if (!csrfToken) return init;
  return {
    ...init,
    headers: { ...init.headers, "X-CSRF-Token": csrfToken },
  };
}
