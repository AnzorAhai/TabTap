import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { Matches } from "class-validator";

/**
 * Database ids: any 8-4-4-4-12 hex string, as Postgres accepts. Stricter RFC version
 * checks (Nest's ParseUUIDPipe, class-validator's IsUUID) reject the fixed ids of the
 * seeded demo data, such as 11111111-1111-1111-1111-111111111111.
 */
export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route param pipe: 400 for anything that isn't an id, before it reaches the database. */
@Injectable()
export class ParseIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
      throw new BadRequestException("Validation failed (uuid is expected)");
    }
    return value.toLowerCase();
  }
}

/** DTO field validator for ids. */
export const IsId = () => Matches(ID_PATTERN, { message: "$property must be a UUID" });
