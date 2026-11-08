import { HttpException, NotFoundException, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "../src/common/all-exceptions.filter";
import { reportError } from "../src/common/error-reporting";

vi.mock("../src/common/error-reporting", async (original) => ({
  ...(await original<typeof import("../src/common/error-reporting")>()),
  reportError: vi.fn(),
}));

function host(path = "/tenants/:tenantId/payments"): ArgumentsHost {
  const response = { status: () => response, json: () => response };
  const request = { method: "GET", originalUrl: "/tables/secret-qr-token/bill", route: { path } };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
}

describe("error reporting", () => {
  it("reports server errors by route, without the URL's tokens", () => {
    vi.mocked(reportError).mockClear();
    const boom = new Error("boom");
    new AllExceptionsFilter().catch(boom, host());
    expect(reportError).toHaveBeenCalledWith(boom, "GET /tenants/:tenantId/payments");
  });

  it("reports a failing gateway (502) but not requests the client got wrong", () => {
    vi.mocked(reportError).mockClear();
    new AllExceptionsFilter().catch(new NotFoundException(), host());
    expect(reportError).not.toHaveBeenCalled();
    new AllExceptionsFilter().catch(new HttpException("bad gateway", 502), host());
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("strips the request from every event", async () => {
    const { scrubEvent } = await vi.importActual<typeof import("../src/common/error-reporting")>(
      "../src/common/error-reporting",
    );
    const event = {
      message: "x",
      request: { url: "https://api/tables/secret", headers: { authorization: "Bearer t" } },
    };
    expect(scrubEvent(event)).toEqual({ message: "x" });
  });
});
