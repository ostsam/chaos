import { config } from "dotenv"
import { z } from "zod"

config()

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"]) 
    .default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid PostgreSQL connection string"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters long")
    .default("dev-secret-please-change-me-1234567890"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  MAX_FILE_SIZE: z.coerce.number().default(10 * 1024 * 1024),
  UPLOAD_DIR: z.string().default("../../uploads")
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error("❌ Invalid environment configuration", parsed.error.flatten().fieldErrors)
  throw new Error("Invalid environment variables. Please check your .env file.")
}

export const env = parsed.data
