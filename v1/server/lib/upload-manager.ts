import { existsSync, createWriteStream, unlinkSync } from "fs"
import { readdir, stat, mkdir } from "fs/promises"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import { env } from "../config/env.js"

interface UploadLimits {
  maxConcurrentUploads: number
  maxConcurrentPerUser: number
  maxBandwidthMBps: number
  maxDiskUsageGB: number
  maxMemoryUsageMB: number
}

interface ActiveUpload {
  id: string
  userId: string
  filename: string
  size: number
  startTime: Date
  stream?: NodeJS.WritableStream
}

interface UploadMetrics {
  totalUploads: number
  activeUploads: number
  totalBandwidth: number
  diskUsage: number
  memoryUsage: number
}

class UploadManager {
  private static instance: UploadManager
  private activeUploads = new Map<string, ActiveUpload>()
  private userUploads = new Map<string, Set<string>>()
  private limits: UploadLimits = {
    maxConcurrentUploads: 50,
    maxConcurrentPerUser: 3,
    maxBandwidthMBps: 100,
    maxDiskUsageGB: 50,
    maxMemoryUsageMB: 1000
  }
  private metrics: UploadMetrics = {
    totalUploads: 0,
    activeUploads: 0,
    totalBandwidth: 0,
    diskUsage: 0,
    memoryUsage: 0
  }

  private constructor() {
    setInterval(() => this.updateMetrics(), 10_000)
    setInterval(() => this.cleanupStaleUploads(), 30_000)
    void this.updateDiskUsage()
  }

  static getInstance(): UploadManager {
    if (!UploadManager.instance) {
      UploadManager.instance = new UploadManager()
    }
    return UploadManager.instance
  }

  async canStartUpload(userId: string, fileSize: number): Promise<{ allowed: boolean; reason?: string }> {
    if (this.activeUploads.size >= this.limits.maxConcurrentUploads) {
      return { allowed: false, reason: "Server at maximum upload capacity. Please try again later." }
    }

    const userActiveUploads = this.userUploads.get(userId) ?? new Set<string>()
    if (userActiveUploads.size >= this.limits.maxConcurrentPerUser) {
      return {
        allowed: false,
        reason: "Maximum concurrent uploads per user reached. Please wait for current uploads to finish."
      }
    }

    await this.updateDiskUsage()
    const estimatedSize = fileSize / (1024 * 1024 * 1024)
    if (this.metrics.diskUsage + estimatedSize > this.limits.maxDiskUsageGB) {
      return {
        allowed: false,
        reason: "Server storage capacity reached. Please try again later or upload smaller files."
      }
    }

    if (this.metrics.memoryUsage + fileSize / (1024 * 1024) > this.limits.maxMemoryUsageMB) {
      return {
        allowed: false,
        reason: "Server memory capacity reached. Please try again later."
      }
    }

    return { allowed: true }
  }

  async startUpload(userId: string, filename: string, fileSize: number): Promise<string> {
    const uploadId = uuidv4()
    const upload: ActiveUpload = {
      id: uploadId,
      userId,
      filename,
      size: fileSize,
      startTime: new Date()
    }

    this.activeUploads.set(uploadId, upload)

    if (!this.userUploads.has(userId)) {
      this.userUploads.set(userId, new Set())
    }
    this.userUploads.get(userId)!.add(uploadId)

    this.metrics.activeUploads += 1
    this.metrics.totalUploads += 1
    this.metrics.memoryUsage += fileSize / (1024 * 1024)

    return uploadId
  }

  createThrottledStream(uploadId: string, filePath: string): NodeJS.WritableStream {
    const upload = this.activeUploads.get(uploadId)
    if (!upload) {
      throw new Error("Upload not found")
    }

    const stream = createWriteStream(filePath)

    let bytesWritten = 0
    let lastCheck = Date.now()

    const originalWrite = stream.write.bind(stream)
    stream.write = ((chunk: any, encoding?: any, callback?: any) => {
      bytesWritten += chunk.length
      const now = Date.now()
      const elapsed = now - lastCheck

      if (elapsed > 100) {
        const currentRate = (bytesWritten / elapsed) * 1000
        const maxRate =
          (this.limits.maxBandwidthMBps * 1024 * 1024) / Math.max(1, this.activeUploads.size)

        if (currentRate > maxRate) {
          const delay = Math.min(100, ((currentRate - maxRate) / maxRate) * 50)
          setTimeout(() => originalWrite(chunk, encoding, callback), delay)
        } else {
          originalWrite(chunk, encoding, callback)
        }

        lastCheck = now
        bytesWritten = 0
      } else {
        originalWrite(chunk, encoding, callback)
      }

      return true
    }) as typeof stream.write

    upload.stream = stream
    return stream
  }

  completeUpload(uploadId: string): void {
    const upload = this.activeUploads.get(uploadId)
    if (!upload) {
      return
    }

    this.activeUploads.delete(uploadId)

    const userUploads = this.userUploads.get(upload.userId)
    if (userUploads) {
      userUploads.delete(uploadId)
      if (userUploads.size === 0) {
        this.userUploads.delete(upload.userId)
      }
    }

    this.metrics.activeUploads = Math.max(0, this.metrics.activeUploads - 1)
    this.metrics.memoryUsage = Math.max(0, this.metrics.memoryUsage - upload.size / (1024 * 1024))

    if (upload.stream) {
      upload.stream.end()
    }
  }

  cancelUpload(uploadId: string, filePath?: string): void {
    this.completeUpload(uploadId)

    if (filePath && existsSync(filePath)) {
      try {
        unlinkSync(filePath)
      } catch (error) {
        if (env.NODE_ENV !== "production") {
          console.error("Error cleaning cancelled upload", error)
        }
      }
    }
  }

  getMetrics(): UploadMetrics & { limits: UploadLimits } {
    return {
      ...this.metrics,
      limits: this.limits
    }
  }

  getUserUploads(userId: string): ActiveUpload[] {
    const ids = this.userUploads.get(userId) ?? new Set<string>()
    return Array.from(ids)
      .map((id) => this.activeUploads.get(id))
      .filter((upload): upload is ActiveUpload => Boolean(upload))
  }

  private async updateDiskUsage(): Promise<void> {
    try {
      const uploadDir = env.UPLOAD_DIR
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true })
        this.metrics.diskUsage = 0
        return
      }

      this.metrics.diskUsage = await this.calculateDirectorySize(uploadDir)
    } catch (error) {
      if (env.NODE_ENV !== "production") {
        console.error("Error updating disk usage", error)
      }
    }
  }

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let total = 0
    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          total += await this.calculateDirectorySize(entryPath)
        } else {
          const stats = await stat(entryPath)
          total += stats.size
        }
      }
    } catch {
      return 0
    }
    return total / (1024 * 1024 * 1024)
  }

  private updateMetrics(): void {
    let totalBandwidth = 0
    const now = Date.now()

    this.activeUploads.forEach((upload) => {
      const duration = (now - upload.startTime.getTime()) / 1000
      if (duration > 0) {
        totalBandwidth += upload.size / duration
      }
    })

    this.metrics.totalBandwidth = totalBandwidth / (1024 * 1024)
  }

  private cleanupStaleUploads(): void {
    const now = Date.now()
    const timeout = 60 * 60 * 1000

    this.activeUploads.forEach((upload, uploadId) => {
      if (now - upload.startTime.getTime() > timeout) {
        this.cancelUpload(uploadId)
      }
    })
  }
}

export default UploadManager.getInstance()
