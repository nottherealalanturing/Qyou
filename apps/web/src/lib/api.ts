export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: { database: 'up' | 'down' };
  timestamp: string;
}

export type ApiStatus =
  { reachable: true; report: ReadinessReport } | { reachable: false; reason: string };

export function apiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
}

/** Server-side readiness check. Never throws: an unreachable API is a normal, displayable state. */
export async function getApiStatus(
  baseUrl: string = apiBaseUrl(),
  fetchImpl: typeof fetch = fetch,
): Promise<ApiStatus> {
  try {
    const response = await fetchImpl(`${baseUrl}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    // 503 carries a valid report describing which dependency is down.
    if (response.ok || response.status === 503) {
      const body = (await response.json()) as Partial<ReadinessReport>;
      if (body.checks) return { reachable: true, report: body as ReadinessReport };
    }
    return { reachable: false, reason: `Unexpected response (HTTP ${response.status})` };
  } catch (error) {
    return {
      reachable: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
