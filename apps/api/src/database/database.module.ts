import { Global, Module } from "@nestjs/common";
import { Pool } from "pg";

export const DB_POOL = Symbol("DB_POOL");

const poolProvider = {
  provide: DB_POOL,
  useFactory: () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — see apps/api/.env.example");
    }
    return new Pool({ connectionString });
  },
};

@Global()
@Module({
  providers: [poolProvider],
  exports: [DB_POOL],
})
export class DatabaseModule {}
