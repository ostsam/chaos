import { Router } from "express";
import cuid from "cuid";
import { and, desc, eq, exists, inArray, ne, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getSecureDb } from "../db/client.js";
import {
	attachments,
	conversations,
	messageReceipts,
	messages,
	participants,
	users,
} from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit, containsPotentialXSS } from "../lib/security.js";

const router = Router();

const createChatSchema = z.object({
	type: z.enum(["DIRECT", "GROUP"]),
	participantIds: z.array(z.string()).min(1),
	name: z.string().max(100).optional(),
	description: z.string().max(255).optional(),
});

const attachmentSchema = z.object({
	fileName: z.string(),
	originalName: z.string(),
	fileType: z.string(),
	fileSize: z.number(),
	mimeType: z.string(),
	url: z.string(),
	thumbnailUrl: z.string().nullable().optional(),
	duration: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
});

const sendMessageSchema = z.object({
	content: z.string().optional(),
	type: z
		.enum([
			"TEXT",
			"IMAGE",
			"VIDEO",
			"AUDIO",
			"DOCUMENT",
			"LOCATION",
			"CONTACT",
			"STICKER",
			"VOICE_NOTE",
		])
		.default("TEXT"),
	replyToId: z.string().optional(),
	attachments: z.array(attachmentSchema).optional(),
});

router.get("/", requireAuth, async (req, res) => {
	const userId = req.user!.id;
	const secureDb = getSecureDb(userId);

	try {
		const chats = await secureDb.withRLS(async (tx) => {
			const conversationRecords = await tx.query.conversations.findMany({
				where: (conversation, { exists, eq, and }) =>
					exists(
						tx
							.select({ value: sql`1` })
							.from(participants)
							.where(
								and(
									eq(participants.conversationId, conversation.id),
									eq(participants.userId, userId),
									eq(participants.isActive, true)
								)
							)
					),
				with: {
					participants: {
						where: (participant, { eq }) => eq(participant.isActive, true),
						with: {
							user: {
								columns: {
									id: true,
									username: true,
									avatar: true,
									isOnline: true,
									lastSeen: true,
								},
							},
						},
					},
					messages: {
						limit: 1,
						orderBy: (message, { desc }) => desc(message.createdAt),
						with: {
							sender: {
								columns: {
									id: true,
									username: true,
								},
							},
							attachments: {
								columns: {
									id: true,
									fileType: true,
									fileName: true,
								},
							},
						},
					},
				},
				orderBy: (conversation, { desc }) => desc(conversation.updatedAt),
			});

			const chatsPayload = [] as Array<{
				id: string;
				type: string;
				name: string | null;
				avatar: string | null;
				participants: Array<{
					id: string;
					username: string;
					avatar: string | null;
					isOnline: boolean;
					lastSeen: Date | null;
				}>;
				lastMessage: {
					id: string;
					content: string | null;
					type: string;
					sender: string;
					createdAt: Date;
					hasAttachment: boolean;
				} | null;
				unreadCount: number;
				updatedAt: Date;
			}>;

			for (const conversation of conversationRecords) {
				const otherParticipants = conversation.participants.filter(
					(participant) => participant.userId !== userId
				);
				const lastMessage = conversation.messages[0];

				const unreadResult = await tx.execute<{ value: number }>(sql`
          SELECT COUNT(*)::int AS value
          FROM "messages" m
          WHERE m."conversationId" = ${conversation.id}
            AND m."senderId" <> ${userId}
            AND NOT EXISTS (
              SELECT 1 FROM "message_receipts" mr
              WHERE mr."messageId" = m."id"
                AND mr."userId" = ${userId}
                AND mr."status" = 'READ'
            )
        `);

				chatsPayload.push({
					id: conversation.id,
					type: conversation.type,
					name:
						conversation.name ??
						(conversation.type === "DIRECT"
							? otherParticipants[0]?.user.username ?? "Direct Chat"
							: "Group Chat"),
					avatar:
						conversation.avatar ?? otherParticipants[0]?.user.avatar ?? null,
					participants: otherParticipants.map((participant) => ({
						id: participant.user.id,
						username: participant.user.username,
						avatar: participant.user.avatar,
						isOnline: participant.user.isOnline,
						lastSeen: participant.user.lastSeen,
					})),
					lastMessage: lastMessage
						? {
								id: lastMessage.id,
								content: lastMessage.content,
								type: lastMessage.type,
								sender: lastMessage.sender.username,
								createdAt: lastMessage.createdAt,
								hasAttachment: lastMessage.attachments.length > 0,
						  }
						: null,
					unreadCount: unreadResult[0]?.value ?? 0,
					updatedAt: conversation.updatedAt,
				});
			}

			return chatsPayload;
		});

		return res.json({ chats });
	} catch (error) {
		return res.status(500).json({ error: "Failed to fetch chats" });
	}
});

router.post("/", requireAuth, async (req, res) => {
	try {
		const { type, participantIds, name, description } = createChatSchema.parse(
			req.body
		);
		const currentUserId = req.user!.id;
		const uniqueParticipantIds = Array.from(
			new Set(participantIds.filter((id) => id !== currentUserId))
		);

		const secureDb = getSecureDb(currentUserId);

		const conversation = await secureDb.withRLS(async (tx) => {
			if (uniqueParticipantIds.length === 0) {
				throw Object.assign(
					new Error("At least one other participant required"),
					{ status: 400 }
				);
			}

			const existingUsers = await tx
				.select({ id: users.id })
				.from(users)
				.where(inArray(users.id, uniqueParticipantIds));

			if (existingUsers.length !== uniqueParticipantIds.length) {
				throw Object.assign(new Error("Some participants not found"), {
					status: 400,
				});
			}

			if (type === "DIRECT" && uniqueParticipantIds.length === 1) {
				const [possibleChat] = await tx.execute<{ id: string }>(sql`
          SELECT c.id
          FROM "conversations" c
          WHERE c.type = 'DIRECT'
            AND EXISTS (
              SELECT 1 FROM "participants" p
              WHERE p."conversationId" = c.id
                AND p."userId" = ${currentUserId}
                AND p."isActive" = true
            )
            AND EXISTS (
              SELECT 1 FROM "participants" p
              WHERE p."conversationId" = c.id
                AND p."userId" = ${uniqueParticipantIds[0]}
                AND p."isActive" = true
            )
          LIMIT 1
        `);

				if (possibleChat) {
					throw Object.assign(new Error("Direct conversation already exists"), {
						status: 409,
						chatId: possibleChat.id,
					});
				}
			}

			const conversationId = cuid();
			await tx.insert(conversations).values({
				id: conversationId,
				type,
				name: name ?? null,
				description: description ?? null,
			});

			const creatorRole = (type === "GROUP" ? "ADMIN" : "MEMBER") as
				| "ADMIN"
				| "MODERATOR"
				| "MEMBER";

			const participantRows = [
				{
					id: cuid(),
					userId: currentUserId,
					conversationId,
					role: creatorRole,
				},
				...uniqueParticipantIds.map((participantId) => ({
					id: cuid(),
					userId: participantId,
					conversationId,
					role: "MEMBER" as const,
				})),
			] satisfies Array<typeof participants.$inferInsert>;

			await tx.insert(participants).values(participantRows);

			const createdConversation = await tx.query.conversations.findFirst({
				where: (conversationTable, { eq }) =>
					eq(conversationTable.id, conversationId),
				with: {
					participants: {
						with: {
							user: {
								columns: {
									id: true,
									username: true,
									avatar: true,
								},
							},
						},
					},
				},
			});

			if (!createdConversation) {
				throw new Error("Conversation creation failed");
			}

			return createdConversation;
		});

		return res.status(201).json({ conversation });
	} catch (error: any) {
		if (error?.status === 409) {
			return res
				.status(409)
				.json({
					error: "Direct conversation already exists",
					chatId: error.chatId,
				});
		}

		if (error instanceof z.ZodError) {
			return res
				.status(400)
				.json({ error: "Invalid request data", details: error.errors });
		}

		if (error?.status) {
			return res.status(error.status).json({ error: error.message });
		}

		return res.status(500).json({ error: "Failed to create chat" });
	}
});

router.get("/:chatId/messages", requireAuth, async (req, res) => {
	const userId = req.user!.id;
	const { chatId } = req.params;
	const page =
		typeof req.query.page === "string" ? parseInt(req.query.page, 10) : 1;
	const limitParam =
		typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
	const limit = Number.isNaN(limitParam) ? 50 : Math.min(limitParam, 100);
	const before =
		typeof req.query.before === "string"
			? new Date(req.query.before)
			: undefined;

	const secureDb = getSecureDb(userId);

	try {
		const result = await secureDb.withRLS(async (tx) => {
			const membership = await tx.query.participants.findFirst({
				where: (participant, { eq, and }) =>
					and(
						eq(participant.userId, userId),
						eq(participant.conversationId, chatId)
					),
			});

			if (!membership || !membership.isActive) {
				throw Object.assign(new Error("Access denied"), { status: 403 });
			}

			const messagesData = await tx.query.messages.findMany({
				where: (message, { eq, lt, and }) =>
					before
						? and(
								eq(message.conversationId, chatId),
								lt(message.createdAt, before)
						  )
						: eq(message.conversationId, chatId),
				with: {
					sender: {
						columns: {
							id: true,
							username: true,
							avatar: true,
						},
					},
					attachments: true,
					reactions: true,
					receipts: true,
					replyTo: {
						with: {
							sender: {
								columns: {
									id: true,
									username: true,
								},
							},
						},
					},
				},
				orderBy: (message, { desc }) => desc(message.createdAt),
				limit,
			});

			const [{ value: totalMessages }] = await tx.execute<{
				value: number;
			}>(sql`
        SELECT COUNT(*)::int AS value
        FROM "messages"
        WHERE "conversationId" = ${chatId}
      `);

			const transformed = messagesData.map((message) => ({
				id: message.id,
				content: message.content,
				type: message.type,
				status: message.status,
				createdAt: message.createdAt,
				updatedAt: message.updatedAt,
				sender: {
					id: message.sender.id,
					username: message.sender.username,
					avatar: message.sender.avatar,
				},
				attachments: message.attachments,
				reactions: message.reactions,
				receipts: message.receipts,
				replyTo: message.replyTo
					? {
							id: message.replyTo.id,
							content: message.replyTo.content,
							sender: message.replyTo.sender.username,
					  }
					: null,
				repliesCount: 0,
			}));

			return {
				messages: transformed.reverse(),
				pagination: {
					page,
					limit,
					total: totalMessages,
					hasMore: messagesData.length === limit,
					cursor:
						messagesData.length > 0
							? messagesData[messagesData.length - 1].createdAt.toISOString()
							: null,
				},
			};
		});

		return res.json(result);
	} catch (error: any) {
		if (error?.status === 403) {
			return res.status(403).json({ error: "Access denied" });
		}

		return res.status(500).json({ error: "Failed to fetch messages" });
	}
});

router.post("/:chatId/messages", requireAuth, async (req, res) => {
	const userId = req.user!.id;
	const { chatId } = req.params;

	if (!rateLimit(req, userId)) {
		return res.status(429).json({ error: "Rate limit exceeded" });
	}

	try {
		const {
			content,
			type,
			replyToId,
			attachments: attachmentPayload = [],
		} = sendMessageSchema.parse(req.body);

		const secureDb = getSecureDb(userId);

		const messageRecord = await secureDb.withRLS(async (tx) => {
			const membership = await tx.query.participants.findFirst({
				where: (participant, { eq, and }) =>
					and(
						eq(participant.userId, userId),
						eq(participant.conversationId, chatId)
					),
			});

			if (!membership || !membership.isActive) {
				throw Object.assign(new Error("Access denied"), { status: 403 });
			}

			if (!content && attachmentPayload.length === 0) {
				throw Object.assign(
					new Error("Message must have content or attachments"),
					{ status: 400 }
				);
			}

			if (content && containsPotentialXSS(content)) {
				throw Object.assign(new Error("Message contains invalid content"), {
					status: 400,
				});
			}

			if (replyToId) {
				const replyExists = await tx.query.messages.findFirst({
					where: (message, { eq, and }) =>
						and(eq(message.id, replyToId), eq(message.conversationId, chatId)),
				});

				if (!replyExists) {
					throw Object.assign(new Error("Reply message not found"), {
						status: 400,
					});
				}
			}

			const messageId = cuid();
			await tx.insert(messages).values({
				id: messageId,
				content: content ?? null,
				type,
				conversationId: chatId,
				senderId: userId,
				replyToId: replyToId ?? null,
			});

			if (attachmentPayload.length > 0) {
				await tx.insert(attachments).values(
					attachmentPayload.map((attachment) => ({
						id: cuid(),
						messageId,
						fileName: attachment.fileName,
						originalName: attachment.originalName,
						fileType: attachment.fileType,
						fileSize: attachment.fileSize,
						mimeType: attachment.mimeType,
						url: attachment.url,
						thumbnailUrl: attachment.thumbnailUrl ?? null,
						duration: attachment.duration ?? null,
						width: attachment.width ?? null,
						height: attachment.height ?? null,
					}))
				);
			}

			await tx
				.update(conversations)
				.set({ updatedAt: new Date() })
				.where(eq(conversations.id, chatId));

			const recipients = await tx
				.select({ userId: participants.userId })
				.from(participants)
				.where(
					and(
						eq(participants.conversationId, chatId),
						ne(participants.userId, userId),
						eq(participants.isActive, true)
					)
				);

			if (recipients.length > 0) {
				await tx.insert(messageReceipts).values(
					recipients.map((recipient) => ({
						id: cuid(),
						messageId,
						userId: recipient.userId,
						status: "DELIVERED" as const,
					}))
				);
			}

			const createdMessage = await tx.query.messages.findFirst({
				where: (message, { eq }) => eq(message.id, messageId),
				with: {
					sender: {
						columns: {
							id: true,
							username: true,
							avatar: true,
						},
					},
					attachments: true,
					replyTo: {
						with: {
							sender: {
								columns: {
									id: true,
									username: true,
								},
							},
						},
					},
				},
			});

			if (!createdMessage) {
				throw new Error("Failed to retrieve message");
			}

			return createdMessage;
		});

		return res.status(201).json({ message: messageRecord });
	} catch (error: any) {
		if (error instanceof z.ZodError) {
			return res
				.status(400)
				.json({ error: "Invalid request data", details: error.errors });
		}

		if (error?.status) {
			return res.status(error.status).json({ error: error.message });
		}

		return res.status(500).json({ error: "Failed to send message" });
	}
});

export default router;
