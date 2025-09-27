import type { Request } from "express"
import { z } from "zod"

const rateLimitStore = new Map<string, { count: number; resetTime: number }>()

const RATE_LIMITS: Record<string, { requests: number; windowMs: number }> = {
  "POST:/api/chats/*/messages": { requests: 30, windowMs: 60_000 },
  "POST:/api/upload": { requests: 10, windowMs: 60_000 },
  "POST:/api/messages/*/reactions": { requests: 100, windowMs: 60_000 },
  default: { requests: 100, windowMs: 60_000 }
}

export function rateLimit(request: Request, userId: string): boolean {
  const now = Date.now()
  const method = request.method.toUpperCase()
  const pathname = request.path
  let routePattern = `${method}:${pathname}`

  routePattern = routePattern.replace(/\/[a-zA-Z0-9_-]{25,}/g, "/*")

  const config = RATE_LIMITS[routePattern] ?? RATE_LIMITS.default
  const key = `${userId}:${routePattern}`

  const userLimit = rateLimitStore.get(key)

  if (!userLimit || now > userLimit.resetTime) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs
    })
    return true
  }

  if (userLimit.count >= config.requests) {
    return false
  }

  userLimit.count += 1
  return true
}

export function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "").slice(0, 10_000)
}

export const fileValidationSchema = z.object({
  originalname: z.string().min(1).max(255),
  size: z.number().max(10_485_760),
  mimetype: z.enum([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/ogg",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "audio/mpeg",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain"
  ])
})

export const messageValidationSchema = z.object({
  content: z
    .string()
    .optional()
    .refine((content) => (content ? content.length <= 4000 : true), "Message too long"),
  type: z.enum([
    "TEXT",
    "IMAGE",
    "VIDEO",
    "AUDIO",
    "DOCUMENT",
    "LOCATION",
    "CONTACT",
    "STICKER",
    "VOICE_NOTE"
  ]),
  replyToId: z.string().optional()
})

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")

export const emailSchema = z.string().email("Invalid email address")

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Password must contain lowercase, uppercase, and a number")

export function containsPotentialXSS(text: string): boolean {
  const patterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe\b[^>]*>/gi,
    /<embed\b[^>]*>/gi,
    /<object\b[^>]*>/gi
  ]
  return patterns.some((pattern) => pattern.test(text))
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(0, 255)
}

export function isValidCUID(id: string): boolean {
  return /^c[a-z0-9]{24}$/.test(id)
}
