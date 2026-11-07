import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";
import { toErrorResponse } from "../src/common/all-exceptions.filter";

function pgError(code: string): DatabaseError {
  const err = new DatabaseError("database said no", 0, "error");
  err.code = code;
  return err;
}

describe("toErrorResponse", () => {
  it("keeps the status and message of HTTP exceptions", () => {
    expect(toErrorResponse(new NotFoundException("Bill x not found"))).toEqual({
      status: 404,
      body: { statusCode: 404, error: "Not Found", message: "Bill x not found" },
    });
  });

  it("keeps validation message lists", () => {
    const { status, body } = toErrorResponse(new BadRequestException(["a must be a UUID", "b must be positive"]));
    expect(status).toBe(400);
    expect(body.message).toEqual(["a must be a UUID", "b must be positive"]);
  });

  it.each([
    ["22P02", 400],
    ["23503", 400],
    ["23505", 409],
    ["23514", 400],
  ])("maps Postgres error %s caused by client input to %i", (code, status) => {
    const result = toErrorResponse(pgError(code));
    expect(result.status).toBe(status);
    expect(result.body.message).not.toContain("database said no");
  });

  it("hides details of unexpected errors behind a generic 500", () => {
    expect(toErrorResponse(new Error("connection string postgres://secret@db"))).toEqual({
      status: 500,
      body: { statusCode: 500, error: "Internal Server Error", message: "Internal server error" },
    });
    expect(toErrorResponse(pgError("53300")).status).toBe(500);
  });
});
