/**
 * Turns Google API error responses into short, actionable messages for the Settings screen
 * (instead of dumping Google's raw JSON).
 */

interface GoogleErrorBody {
  error?:
    | string
    | {
        code?: number;
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string }>;
        details?: Array<{
          '@type'?: string;
          reason?: string;
          metadata?: { serviceTitle?: string; activationUrl?: string; service?: string };
        }>;
      };
  error_description?: string;
}

export function describeGoogleError(apiLabel: string, status: number, bodyText: string): string {
  let body: GoogleErrorBody = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    // non-JSON body
  }

  // OAuth token endpoint errors: {"error": "invalid_grant", "error_description": "..."}
  if (typeof body.error === 'string') {
    if (body.error === 'invalid_grant') {
      return 'Google sign-in for this account expired or was revoked. Disconnect the account in Settings and connect it again.';
    }
    if (body.error === 'invalid_client' || body.error === 'unauthorized_client') {
      return 'Google rejected Lucarne\'s OAuth client ID/secret. Check the Client ID and Secret in .env or Settings.';
    }
    return `${apiLabel} sign-in error: ${body.error_description || body.error}`;
  }

  const err = body.error;
  const reasons = [
    ...(err?.details ?? []).map((d) => d.reason),
    ...(err?.errors ?? []).map((e) => e.reason),
  ].filter(Boolean) as string[];
  const info = err?.details?.find((d) => d.metadata?.activationUrl || d.metadata?.serviceTitle)?.metadata;
  const service = info?.serviceTitle || apiLabel;

  if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured')) {
    const link = info?.activationUrl ? ` Enable it here: ${info.activationUrl}` : '';
    return `${service} isn't enabled in your Google Cloud project.${link} Then wait a few minutes and try again.`;
  }
  if (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || reasons.includes('insufficientPermissions')) {
    return `Lucarne doesn't have permission to use ${apiLabel} for this account. Disconnect the account in Settings and connect it again, making sure every permission checkbox on Google's screen is ticked.`;
  }
  if (status === 401) {
    return 'Google sign-in for this account expired or was revoked. Disconnect the account in Settings and connect it again.';
  }
  if (status === 429 || reasons.includes('RATE_LIMIT_EXCEEDED') || reasons.includes('rateLimitExceeded')) {
    return `Google is temporarily limiting ${apiLabel} requests. Try again in a minute.`;
  }
  if (status >= 500) {
    return `${apiLabel} is having problems on Google's side (HTTP ${status}). Try again shortly.`;
  }
  if (status === 404) {
    return `${apiLabel}: not found (HTTP 404). It may have been deleted or you may no longer have access.`;
  }

  const message = err?.message || bodyText.replace(/\s+/g, ' ').trim().slice(0, 200) || 'no details';
  return `${apiLabel} error (HTTP ${status}): ${message}`;
}

/** Builds an Error from a failed fetch Response. */
export async function googleApiError(apiLabel: string, res: Response): Promise<Error> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    // ignore
  }
  return new Error(describeGoogleError(apiLabel, res.status, text));
}
