import { relations, sql } from "drizzle-orm"
import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  pgEnum,
  uniqueIndex
} from "drizzle-orm/pg-core"

export const conversationTypeEnum = pgEnum("conversationtype", ["DIRECT", "GROUP"])
export const participantRoleEnum = pgEnum("participantrole", ["ADMIN", "MODERATOR", "MEMBER"])
export const messageTypeEnum = pgEnum("messagetype", [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "DOCUMENT",
  "LOCATION",
  "CONTACT",
  "STICKER",
  "VOICE_NOTE"
])
export const messageStatusEnum = pgEnum("messagestatus", ["SENT", "DELIVERED", "READ", "FAILED"])
export const receiptStatusEnum = pgEnum("receiptstatus", ["DELIVERED", "READ"])

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  avatar: text("avatar"),
  status: text("status").notNull().default("Hey there! I am using WhatsApp."),
  lastSeen: timestamp("lastSeen", { withTimezone: false }).notNull().default(sql`now()`),
  isOnline: boolean("isOnline").notNull().default(false),
  createdAt: timestamp("createdAt", { withTimezone: false }).notNull().default(sql`now()`),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).notNull().default(sql`now()`).$onUpdate(() => new Date())
})

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refreshToken: text("refresh_token"),
  accessToken: text("access_token"),
  expiresAt: integer("expires_at"),
  tokenType: text("token_type"),
  scope: text("scope"),
  idToken: text("id_token"),
  sessionState: text("session_state")
}, (table) => ({
  providerAccountUnique: uniqueIndex("accounts_provider_account_unique").on(table.provider, table.providerAccountId)
}))

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  sessionToken: text("sessionToken").notNull().unique(),
  userId: text("userId").notNull(),
  expires: timestamp("expires", { withTimezone: false }).notNull()
})

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  type: conversationTypeEnum("type").notNull().default("DIRECT"),
  name: text("name"),
  description: text("description"),
  avatar: text("avatar"),
  createdAt: timestamp("createdAt", { withTimezone: false }).notNull().default(sql`now()`),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).notNull().default(sql`now()`).$onUpdate(() => new Date())
})

export const participants = pgTable("participants", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  conversationId: text("conversationId").notNull(),
  role: participantRoleEnum("role").notNull().default("MEMBER"),
  joinedAt: timestamp("joinedAt", { withTimezone: false }).notNull().default(sql`now()`),
  lastReadAt: timestamp("lastReadAt", { withTimezone: false }),
  isActive: boolean("isActive").notNull().default(true)
}, (table) => ({
  userConversationUnique: uniqueIndex("participants_user_conversation_unique").on(table.userId, table.conversationId)
}))

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  content: text("content"),
  type: messageTypeEnum("type").notNull().default("TEXT"),
  status: messageStatusEnum("status").notNull().default("SENT"),
  senderId: text("senderId").notNull(),
  conversationId: text("conversationId").notNull(),
  replyToId: text("replyToId"),
  createdAt: timestamp("createdAt", { withTimezone: false }).notNull().default(sql`now()`),
  updatedAt: timestamp("updatedAt", { withTimezone: false }).notNull().default(sql`now()`).$onUpdate(() => new Date())
})

export const attachments = pgTable("attachments", {
  id: text("id").primaryKey(),
  messageId: text("messageId").notNull(),
  fileName: text("fileName").notNull(),
  originalName: text("originalName").notNull(),
  fileType: text("fileType").notNull(),
  fileSize: integer("fileSize").notNull(),
  mimeType: text("mimeType").notNull(),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  duration: integer("duration"),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("createdAt", { withTimezone: false }).notNull().default(sql`now()`)
})

export const reactions = pgTable("reactions", {
  id: text("id").primaryKey(),
  messageId: text("messageId").notNull(),
  userId: text("userId").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: false }).notNull().default(sql`now()`)
}, (table) => ({
  messageUserEmojiUnique: uniqueIndex("reactions_message_user_emoji_unique").on(table.messageId, table.userId, table.emoji)
}))

export const messageReceipts = pgTable("message_receipts", {
  id: text("id").primaryKey(),
  messageId: text("messageId").notNull(),
  userId: text("userId").notNull(),
  status: receiptStatusEnum("status").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: false }).notNull().default(sql`now()`)
}, (table) => ({
  messageUserUnique: uniqueIndex("message_receipts_message_user_unique").on(table.messageId, table.userId)
}))

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  participants: many(participants),
  reactions: many(reactions, { relationName: "userReactions" }),
  messages: many(messages, { relationName: "userMessages" })
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id]
  })
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id]
  })
}))

export const conversationsRelations = relations(conversations, ({ many }) => ({
  participants: many(participants),
  messages: many(messages)
}))

export const participantsRelations = relations(participants, ({ one, many }) => ({
  user: one(users, {
    fields: [participants.userId],
    references: [users.id]
  }),
  conversation: one(conversations, {
    fields: [participants.conversationId],
    references: [conversations.id]
  }),
  receipts: many(messageReceipts)
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: "userMessages"
  }),
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id]
  }),
  replyTo: one(messages, {
    fields: [messages.replyToId],
    references: [messages.id]
  }),
  attachments: many(attachments),
  reactions: many(reactions),
  receipts: many(messageReceipts),
  replies: many(messages)
}))

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  message: one(messages, {
    fields: [attachments.messageId],
    references: [messages.id]
  })
}))

export const reactionsRelations = relations(reactions, ({ one }) => ({
  message: one(messages, {
    fields: [reactions.messageId],
    references: [messages.id]
  }),
  user: one(users, {
    fields: [reactions.userId],
    references: [users.id],
    relationName: "userReactions"
  })
}))

export const messageReceiptsRelations = relations(messageReceipts, ({ one }) => ({
  message: one(messages, {
    fields: [messageReceipts.messageId],
    references: [messages.id]
  }),
  user: one(users, {
    fields: [messageReceipts.userId],
    references: [users.id]
  })
}))

export const schema = {
  users,
  accounts,
  sessions,
  conversations,
  participants,
  messages,
  attachments,
  reactions,
  messageReceipts,
  conversationTypeEnum,
  participantRoleEnum,
  messageTypeEnum,
  messageStatusEnum,
  receiptStatusEnum
}
