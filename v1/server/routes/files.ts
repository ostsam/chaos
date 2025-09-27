import { Router } from "express";
import path from "path";
import { existsSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { lookup } from "mime-types";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function resolveWithinUploadDir(filename: string): string | null {
	const uploadDir = path.resolve(env.UPLOAD_DIR);
	const filePath = path.resolve(path.join(uploadDir, filename));
	if (!filePath.startsWith(uploadDir)) {
		return null;
	}
	return filePath;
}

router.get("/:filename", requireAuth, async (req, res) => {
	const { filename } = req.params;
	const filePath = resolveWithinUploadDir(filename);

	if (!filePath) {
		return res.status(403).json({ error: "Access denied" });
	}

	if (!existsSync(filePath)) {
		return res.status(404).json({ error: "File not found" });
	}

	try {
		const buffer = await readFile(filePath);
		const mimeType = lookup(filename) || "application/octet-stream";

		res.setHeader("Content-Type", mimeType as string);
		res.setHeader("Content-Length", buffer.length.toString());
		res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

		return res.send(buffer);
	} catch (error) {
		return res.status(500).json({ error: "Failed to read file" });
	}
});

router.delete("/:filename", requireAuth, async (req, res) => {
	const { filename } = req.params;
	const filePath = resolveWithinUploadDir(filename);

	if (!filePath) {
		return res.status(403).json({ error: "Access denied" });
	}

	if (!existsSync(filePath)) {
		return res.status(404).json({ error: "File not found" });
	}

	try {
		await unlink(filePath);

		const ext = path.extname(filename);
		const thumbnailPath = filePath.replace(ext, `_thumb${ext}`);
		if (existsSync(thumbnailPath)) {
			await unlink(thumbnailPath);
		}

		return res.json({ success: true });
	} catch (error) {
		return res.status(500).json({ error: "Failed to delete file" });
	}
});

export default router;
