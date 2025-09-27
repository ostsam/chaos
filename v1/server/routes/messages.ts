import { Router } from "express";
import cuid from "cuid";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getSecureDb } from "../db/client.js";
import { messages, messageReceipts, reactions } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../lib/security.js";

const router = Router();

router.post("/:messageId/reactions", requireAuth, async (req, res) => {
	try {
		const { messageId } = req.params;
		const userId = req.user!.id;

		if (!rateLimit(req, userId)) {
			return res.status(429).json({ error: "Rate limit exceeded" });
		}

		const { emoji } = z
			.object({ emoji: z.string().min(1).max(10) })
			.parse(req.body);

		const secureDb = getSecureDb(userId);

		const result = await secureDb.withRLS(async (tx) => {
			const messageRecord = await tx.query.messages.findFirst({
				where: (message, { eq }) => eq(message.id, messageId),
			});

			if (!messageRecord) {
				throw Object.assign(new Error("Message not found or access denied"), {
					status: 404,
				});
			}

			const existingReaction = await tx.query.reactions.findFirst({
				where: (reaction, { and, eq }) =>
					and(
						eq(reaction.messageId, messageId),
						eq(reaction.userId, userId),
						eq(reaction.emoji, emoji)
					),
			});

			if (existingReaction) {
				await tx.delete(reactions).where(eq(reactions.id, existingReaction.id));
				return { action: "removed" as const, emoji, userId };
			}

			const [created] = await tx
				.insert(reactions)
				.values({
					id: cuid(),
					messageId,
					userId,
					emoji,
				})
				.returning();

			return {
				action: "added" as const,
				reaction: {
					id: created.id,
					emoji,
					userId,
					createdAt: created.createdAt,
				},
			};
		});

		return res.status(result.action === "added" ? 201 : 200).json(result);
	} catch (error: any) {
		if (error instanceof z.ZodError) {
			return res
				.status(400)
				.json({ error: "Invalid request data", details: error.errors });
		}

		if (error?.status) {
			return res.status(error.status).json({ error: error.message });
		}

		return res.status(500).json({ error: "Failed to update reaction" });
	}
});

router.get("/:messageId/reactions", requireAuth, async (req, res) => {
	try {
		const { messageId } = req.params;
		const userId = req.user!.id;
		const secureDb = getSecureDb(userId);

		const grouped = await secureDb.withRLS(async (tx) => {
			const messageRecord = await tx.query.messages.findFirst({
				where: (message, { eq }) => eq(message.id, messageId),
			});

			if (!messageRecord) {
				throw Object.assign(new Error("Message not found or access denied"), {
					status: 404,
				});
			}

			const reactionRecords = await tx.query.reactions.findMany({
				where: (reaction, { eq }) => eq(reaction.messageId, messageId),
				with: {
					user: {
						columns: {
							id: true,
							username: true,
							avatar: true,
						},
					},
				},
				orderBy: (reaction, { asc }) => asc(reaction.createdAt),
			});

			const groupedReactions: Record<
				string,
				Array<{
					userId: string;
					username: string;
					avatar: string | null;
					createdAt: Date;
				}>
			> = {};

			for (const reaction of reactionRecords) {
				if (!groupedReactions[reaction.emoji]) {
					groupedReactions[reaction.emoji] = [];
				}
				groupedReactions[reaction.emoji].push({
					userId: reaction.userId,
					username: reaction.user.username,
					avatar: reaction.user.avatar,
					createdAt: reaction.createdAt,
				});
			}

			return groupedReactions;
		});

		return res.json({ reactions: grouped });
	} catch (error: any) {
		if (error?.status) {
			return res.status(error.status).json({ error: error.message });
		}

		return res.status(500).json({ error: "Failed to fetch reactions" });
	}
});

router.post("/:messageId/receipt", requireAuth, async (req, res) => {
	try {
		const { messageId } = req.params;
		const userId = req.user!.id;

		const { status } = z
			.object({ status: z.enum(["DELIVERED", "READ"]) })
			.parse(req.body);

		const secureDb = getSecureDb(userId);

		const receipt = await secureDb.withRLS(async (tx) => {
			const messageRecord = await tx.query.messages.findFirst({
				where: (message, { eq }) => eq(message.id, messageId),
			});

			if (!messageRecord) {
				throw Object.assign(new Error("Message not found or access denied"), {
					status: 404,
				});
			}

			if (messageRecord.senderId === userId) {
				throw Object.assign(
					new Error("Cannot update receipt for own message"),
					{ status: 400 }
				);
			}

			const [updated] = await tx
				.insert(messageReceipts)
				.values({
					id: cuid(),
					messageId,
					userId,
					status,
					timestamp: new Date(),
				})
				.onConflictDoUpdate({
					target: [messageReceipts.messageId, messageReceipts.userId],
					set: {
						status,
						timestamp: new Date(),
					},
				})
				.returning();

			if (status === "READ") {
				await tx
					.insert(messageReceipts)
					.values({
						id: cuid(),
						messageId,
						userId,
						status: "DELIVERED",
						timestamp: updated.timestamp,
					})
					.onConflictDoUpdate({
						target: [messageReceipts.messageId, messageReceipts.userId],
						set: {
							status: "DELIVERED",
							timestamp: updated.timestamp,
						},
					});
			}

			return updated;
		});

		return res.json({ receipt });
	} catch (error: any) {
		if (error instanceof z.ZodError) {
			return res
				.status(400)
				.json({ error: "Invalid request data", details: error.errors });
		}

		if (error?.status) {
			return res.status(error.status).json({ error: error.message });
		}

		return res.status(500).json({ error: "Failed to update receipt" });
	}
});

router.get("/:messageId/receipt", requireAuth, async (req, res) => {
	try {
		const { messageId } = req.params;
		const userId = req.user!.id;
		const secureDb = getSecureDb(userId);

		const grouped = await secureDb.withRLS(async (tx) => {
			const messageRecord = await tx.query.messages.findFirst({
				where: (message, { eq }) => eq(message.id, messageId),
			});

			if (!messageRecord) {
				throw Object.assign(new Error("Message not found or access denied"), {
					status: 404,
				});
			}

			const receipts = await tx.query.messageReceipts.findMany({
				where: (receipt, { eq }) => eq(receipt.messageId, messageId),
				with: {
					user: {
						columns: {
							id: true,
							username: true,
							avatar: true,
						},
					},
				},
				orderBy: (receipt, { asc }) => asc(receipt.timestamp),
			});

			return {
				delivered: receipts
					.filter((receipt) => receipt.status === "DELIVERED")
					.map((receipt) => ({
						userId: receipt.userId,
						username: receipt.user.username,
						avatar: receipt.user.avatar,
						timestamp: receipt.timestamp,
					})),
				read: receipts
					.filter((receipt) => receipt.status === "READ")
					.map((receipt) => ({
						userId: receipt.userId,
						username: receipt.user.username,
						avatar: receipt.user.avatar,
						timestamp: receipt.timestamp,
					})),
			};
		});

		return res.json({ receipts: grouped });
	} catch (error: any) {
		if (error?.status) {
			return res.status(error.status).json({ error: error.message });
		}

		return res.status(500).json({ error: "Failed to fetch receipts" });
	}
});

export default router;
