import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { DatabaseError } from "pg";
import { reportError } from "./error-reporting";

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

// Postgres error codes that are caused by bad client input rather than a server bug.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_CLIENT_ERRORS: Record<string, { status: number; message: string }> = {
  "22P02": { status: HttpStatus.BAD_REQUEST, message: "Malformed identifier or value" },
  "23503": { status: HttpStatus.BAD_REQUEST, message: "Referenced record does not exist" },
  "23505": { status: HttpStatus.CONFLICT, message: "Record already exists" },
  "23514": { status: HttpStatus.BAD_REQUEST, message: "Value violates a data constraint" },
};

function reasonPhrase(status: number): string {
  const name = HttpStatus[status] as string | undefined;
  if (!name) return "Error";
  return name
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Maps any thrown value to an HTTP status and a client-safe JSON body. */
export function toErrorResponse(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    if (typeof response === "string") {
      return { status, body: { statusCode: status, error: reasonPhrase(status), message: response } };
    }
    const r = response as Partial<ErrorBody> & Record<string, unknown>;
    return {
      status,
      body: {
        ...r,
        statusCode: status,
        error: typeof r.error === "string" ? r.error : reasonPhrase(status),
        message: r.message ?? exception.message,
      },
    };
  }

  if (exception instanceof DatabaseError && exception.code && PG_CLIENT_ERRORS[exception.code]) {
    const { status, message } = PG_CLIENT_ERRORS[exception.code];
    return { status, body: { statusCode: status, error: reasonPhrase(status), message } };
  }

  // Anything else is a bug or an outage — never leak its details to the client.
  const status = HttpStatus.INTERNAL_SERVER_ERROR;
  return { status, body: { statusCode: status, error: reasonPhrase(status), message: "Internal server error" } };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const { status, body } = toErrorResponse(exception);

    if (status >= 500) {
      const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      this.logger.error(`${request.method} ${request.originalUrl} -> ${status}`, detail);
      const route = (request.route as { path?: string } | undefined)?.path ?? "unknown route";
      reportError(exception, `${request.method} ${route}`);
    }

    response.status(status).json(body);
  }
}
