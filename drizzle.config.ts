import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./v1/server/db/schema.ts",
	out: "./v1/drizzle/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "",
	},
});
