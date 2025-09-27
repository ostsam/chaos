import { Router, raw } from "express";
import multer from "multer";
import { mkdir, writeFile, readdir, readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import UploadManager from "../lib/upload-manager.js";
import { fileValidationSchema, rateLimit } from "../lib/security.js";
import { Readable } from "stream";

const router = Router();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: env.MAX_FILE_SIZE },
});

async function ensureUploadDir() {
	if (!existsSync(env.UPLOAD_DIR)) {
		await mkdir(env.UPLOAD_DIR, { recursive: true });
	}
}

function getFileType(mimeType: string) {
	if (mimeType.startsWith("image/")) return "IMAGE";
	if (mimeType.startsWith("video/")) return "VIDEO";
	if (mimeType.startsWith("audio/")) return "AUDIO";
	return "DOCUMENT";
}

async function generateThumbnail(filePath: string, mimeType: string) {
	if (!mimeType.startsWith("image/")) {
		return null;
	}

	const thumbPath = filePath.replace(/(\.[^.]+)$/u, "_thumb$1");

	try {
		await sharp(filePath)
			.resize(200, 200, { fit: "inside", withoutEnlargement: true })
			.jpeg({ quality: 80 })
			.toFile(thumbPath);
		return thumbPath;
	} catch (error) {
		if (env.NODE_ENV !== "production") {
			console.error("Failed to generate thumbnail", error);
		}
		return null;
	}
}

async function getImageMetadata(filePath: string) {
	try {
		const metadata = await sharp(filePath).metadata();
		return {
			width: metadata.width,
			height: metadata.height,
		};
	} catch (error) {
		if (env.NODE_ENV !== "production") {
			console.error("Unable to read image metadata", error);
		}
		return { width: undefined, height: undefined };
	}
}

router.post("/", requireAuth, upload.single("file"), async (req, res) => {
	try {
		if (!rateLimit(req, req.user!.id)) {
			return res.status(429).json({ error: "Rate limit exceeded" });
		}

		const file = req.file;
		const chatId = req.body?.chatId;

		if (!file) {
			return res.status(400).json({ error: "No file provided" });
		}

		if (!chatId) {
			return res.status(400).json({ error: "Chat ID required" });
		}

		fileValidationSchema.parse({
			originalname: file.originalname,
			size: file.size,
			mimetype: file.mimetype,
		} as any);

		await ensureUploadDir();

		const extension = path.extname(file.originalname);
		const uniqueName = `${uuidv4()}${extension}`;
		const filePath = path.join(env.UPLOAD_DIR, uniqueName);

		await writeFile(filePath, file.buffer);

		const thumbnailPath = await generateThumbnail(filePath, file.mimetype);
		const { width, height } = await getImageMetadata(filePath);

		const attachment = {
			fileName: uniqueName,
			originalName: file.originalname,
			fileType: getFileType(file.mimetype),
			fileSize: file.size,
			mimeType: file.mimetype,
			url: `/api/files/${uniqueName}`,
			thumbnailUrl: thumbnailPath
				? `/api/files/${path.basename(thumbnailPath)}`
				: null,
			width,
			height,
		};

		return res.status(201).json({ attachment, success: true });
	} catch (error) {
		if (error instanceof Error) {
			return res.status(400).json({ error: error.message });
		}
		return res.status(500).json({ error: "Upload failed" });
	}
});

router.put(
	"/",
	requireAuth,
	raw({ type: "application/octet-stream", limit: env.MAX_FILE_SIZE }),
	async (req, res) => {
		try {
			const uploadId = req.query.uploadId as string | undefined;
			const chunkIndex = parseInt((req.query.chunkIndex as string) ?? "0", 10);
			const totalChunks = parseInt(
				(req.query.totalChunks as string) ?? "1",
				10
			);
			const originalName = (req.query.originalName as string) ?? "unknown";

			if (!uploadId) {
				return res.status(400).json({ error: "Upload ID required" });
			}

			await ensureUploadDir();

			const chunkPath = path.join(
				env.UPLOAD_DIR,
				`${uploadId}_chunk_${chunkIndex}`
			);
			await writeFile(chunkPath, req.body as Buffer);

			if (chunkIndex === totalChunks - 1) {
				const finalName = `${uploadId}_${originalName}`;
				const finalPath = path.join(env.UPLOAD_DIR, finalName);

				const chunks = await readdir(env.UPLOAD_DIR)
					.then((files) =>
						files.filter((fileName) =>
							fileName.startsWith(`${uploadId}_chunk_`)
						)
					)
					.then((files) =>
						files.sort(
							(a, b) =>
								parseInt(a.split("_chunk_")[1], 10) -
								parseInt(b.split("_chunk_")[1], 10)
						)
					);

				const buffers = [] as Buffer[];
				for (const chunkFile of chunks) {
					const data = await readFile(path.join(env.UPLOAD_DIR, chunkFile));
					buffers.push(data);
					await unlink(path.join(env.UPLOAD_DIR, chunkFile));
				}

				await writeFile(finalPath, Buffer.concat(buffers));

				return res.json({
					uploadComplete: true,
					fileName: finalName,
					filePath: finalPath,
				});
			}

			return res.json({ chunkReceived: chunkIndex, uploadComplete: false });
		} catch (error) {
			return res.status(500).json({ error: "Chunk upload failed" });
		}
	}
);

router.post("/v2", requireAuth, upload.single("file"), async (req, res) => {
	try {
		const file = req.file;
		const chatId = req.body?.chatId;

		if (!file) {
			return res.status(400).json({ error: "No file provided" });
		}

		if (!chatId) {
			return res.status(400).json({ error: "Chat ID required" });
		}

		const canUpload = await UploadManager.canStartUpload(
			req.user!.id,
			file.size
		);
		if (!canUpload.allowed) {
			return res.status(503).json({
				error: canUpload.reason,
				serverMetrics: UploadManager.getMetrics(),
			});
		}

		await ensureUploadDir();

		const uploadId = await UploadManager.startUpload(
			req.user!.id,
			file.originalname,
			file.size
		);

		try {
			const extension = path.extname(file.originalname);
			const uniqueName = `${uuidv4()}${extension}`;
			const filePath = path.join(env.UPLOAD_DIR, uniqueName);

			const writable = UploadManager.createThrottledStream(uploadId, filePath);
			await new Promise<void>((resolve, reject) => {
				Readable.from(file.buffer).pipe(writable);
				writable.on("finish", resolve);
				writable.on("error", reject);
			});

			const thumbnailPath = await generateThumbnail(filePath, file.mimetype);
			const { width, height } = await getImageMetadata(filePath);

			const attachment = {
				fileName: uniqueName,
				originalName: file.originalname,
				fileType: getFileType(file.mimetype),
				fileSize: file.size,
				mimeType: file.mimetype,
				url: `/api/files/${uniqueName}`,
				thumbnailUrl: thumbnailPath
					? `/api/files/${path.basename(thumbnailPath)}`
					: null,
				width,
				height,
			};

			UploadManager.completeUpload(uploadId);

			return res.status(201).json({
				attachment,
				uploadId,
				success: true,
				serverMetrics: UploadManager.getMetrics(),
			});
		} catch (error) {
			UploadManager.cancelUpload(uploadId);
			throw error;
		}
	} catch (error) {
		if (error instanceof Error) {
			return res.status(500).json({ error: error.message });
		}
		return res.status(500).json({ error: "Enhanced upload failed" });
	}
});

export default router;
