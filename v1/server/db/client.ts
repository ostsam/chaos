import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { env } from "../config/env.js"
import * as schema from "./schema.js"

const client = postgres(env.DATABASE_URL, {
  connect_timeout: 10,
  max: 10,
  prepare: false
})

export const db = drizzle(client, { schema })

export type Database = PostgresJsDatabase<typeof schema>
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

export class SecureDbClient {
  constructor(private readonly userId: string) {}

  async withRLS<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_current_user(${this.userId})`)
      try {
        return await operation(tx)
      } finally {
        await tx.execute(sql`SELECT set_current_user('')`)
      }
    })
  }
}

export function getSecureDb(userId: string): SecureDbClient {
  return new SecureDbClient(userId)
}

export { schema }
