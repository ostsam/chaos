import type { NextFunction, Request, Response } from "express"

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" })
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    return
  }

  const message = err instanceof Error ? err.message : "Internal server error"
  const status = err instanceof HttpError ? err.statusCode : 500

  if (process.env.NODE_ENV !== "production") {
    console.error(err)
  }

  res.status(status).json({ error: message })
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}
