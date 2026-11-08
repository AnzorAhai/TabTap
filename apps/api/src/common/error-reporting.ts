import * as Sentry from "@sentry/node";

type SentryEvent = Parameters<NonNullable<Sentry.NodeOptions["beforeSend"]>>[0];

/** URLs and headers carry QR, invite and session tokens, which must not leave the server. */
export function scrubEvent<T extends Pick<SentryEvent, "request">>(event: T): T {
  delete event.request;
  return event;
}

/** Sends unexpected errors to Sentry when SENTRY_DSN is set; without it, reporting does nothing. */
export function initErrorReporting(dsn: string | undefined, environment: string): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment,
    // Only the error and its stack trace: guests' and staff's data stays here.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: scrubEvent,
    beforeBreadcrumb: () => null, // log lines contain request URLs
  });
}

/** `where` groups errors in the report; keep it free of ids and tokens. */
export function reportError(error: unknown, where: string): void {
  Sentry.captureException(error, { tags: { where } });
}
