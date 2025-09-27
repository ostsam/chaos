import type { Server, Socket } from "socket.io";
import { auth } from "../../v1/server/lib/auth.js";

interface CustomSocket extends Socket {
	userId?: string;
	username?: string;
}

interface AuthData {
	token?: string;
	userId?: string;
	username?: string;
}

interface ChatData {
	chatId: string;
}

interface Attachment {
	id: string;
	fileName: string;
	fileType: string;
	fileSize: number;
	url: string;
}

interface MessageData {
	chatId: string;
	messageId?: string;
	content: string;
	type?: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
	attachments?: Attachment[];
	replyToId?: string;
	createdAt?: Date | string;
}

interface ReceiptData {
	messageId: string;
	chatId: string;
}

interface FileUploadData {
	chatId: string;
	fileName: string;
	progress: number;
	uploadId: string;
}

interface PresenceData {
	isOnline: boolean;
	lastSeen?: Date | string;
}

interface UserInfo {
	socketId: string;
	username?: string;
	isOnline: boolean;
	lastSeen?: Date | string;
}

export function registerChatSocket(io: Server) {
	const activeUsers = new Map<string, UserInfo>();

	io.on("connection", async (socket: CustomSocket) => {
		socket.on("authenticate", async (data: AuthData) => {
			try {
				let userId = data.userId;

				if (data.token) {
					try {
						const result = await (auth.api.getSession as any)({
							headers: {
								authorization: `Bearer ${data.token}`,
							},
						});

						if (result && result.data && result.data.user) {
							userId = result.data.user.id;
						}
					} catch (error) {
						console.error("Socket auth error:", error);
					}
				}
				const username = data.username;

				if (!userId) {
					socket.emit("auth_error", { message: "User ID required" });
					return;
				}

				socket.userId = userId;
				socket.username = username;

				activeUsers.set(userId, {
					socketId: socket.id,
					username,
					isOnline: true,
				});

				socket.join(`user:${userId}`);

				socket.broadcast.emit("user_online", {
					userId,
					username,
					isOnline: true,
				});

				socket.emit("authenticated", { userId, username });
			} catch (error) {
				socket.emit("auth_error", { message: "Invalid token" });
			}
		});

		socket.on("join_chat", (data: ChatData) => {
			if (!socket.userId) {
				socket.emit("error", { message: "Not authenticated" });
				return;
			}

			socket.join(`chat:${data.chatId}`);
		});

		socket.on("leave_chat", (data: ChatData) => {
			if (!socket.userId) {
				return;
			}
			socket.leave(`chat:${data.chatId}`);
		});

		socket.on("send_message", (data: MessageData) => {
			if (!socket.userId) {
				socket.emit("error", { message: "Not authenticated" });
				return;
			}

			socket.to(`chat:${data.chatId}`).emit("new_message", {
				id: data.messageId,
				chatId: data.chatId,
				content: data.content,
				type: data.type ?? "TEXT",
				senderId: socket.userId,
				senderUsername: socket.username,
				attachments: data.attachments ?? [],
				replyToId: data.replyToId,
				createdAt: data.createdAt ?? new Date(),
				status: "SENT",
			});
		});

		socket.on("typing_start", (data: ChatData) => {
			if (!socket.userId) return;

			socket.to(`chat:${data.chatId}`).emit("user_typing", {
				userId: socket.userId,
				username: socket.username,
				chatId: data.chatId,
				isTyping: true,
			});
		});

		socket.on("typing_stop", (data: ChatData) => {
			if (!socket.userId) return;

			socket.to(`chat:${data.chatId}`).emit("user_typing", {
				userId: socket.userId,
				username: socket.username,
				chatId: data.chatId,
				isTyping: false,
			});
		});

		socket.on("message_delivered", (data: ReceiptData) => {
			if (!socket.userId) return;

			socket.to(`chat:${data.chatId}`).emit("message_receipt", {
				messageId: data.messageId,
				userId: socket.userId,
				status: "DELIVERED",
				timestamp: new Date(),
			});
		});

		socket.on("message_read", (data: ReceiptData) => {
			if (!socket.userId) return;

			socket.to(`chat:${data.chatId}`).emit("message_receipt", {
				messageId: data.messageId,
				userId: socket.userId,
				status: "READ",
				timestamp: new Date(),
			});
		});

		socket.on("file_upload_progress", (data: FileUploadData) => {
			if (!socket.userId) return;

			socket.to(`chat:${data.chatId}`).emit("file_upload_progress", {
				userId: socket.userId,
				username: socket.username,
				fileName: data.fileName,
				progress: data.progress,
				uploadId: data.uploadId,
			});
		});

		socket.on("update_presence", (data: PresenceData) => {
			if (!socket.userId) return;

			const userInfo = activeUsers.get(socket.userId) ?? {
				socketId: socket.id,
				username: socket.username,
				isOnline: data.isOnline,
				lastSeen: data.lastSeen,
			};

			userInfo.isOnline = data.isOnline;
			userInfo.lastSeen = data.lastSeen;
			activeUsers.set(socket.userId, userInfo);

			socket.broadcast.emit("user_presence", {
				userId: socket.userId,
				isOnline: data.isOnline,
				lastSeen: data.lastSeen,
			});
		});

		socket.on("disconnect", () => {
			if (socket.userId) {
				activeUsers.delete(socket.userId);
				socket.broadcast.emit("user_online", {
					userId: socket.userId,
					username: socket.username,
					isOnline: false,
				});
			}
		});
	});
}
