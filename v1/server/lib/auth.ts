import { betterAuth } from "better-auth";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { schema } from "../db/schema.js";
import { env } from "../config/env.js";

// Custom Drizzle adapter since the built-in one might not be properly exported
function createDrizzleAdapter(db: any, schema: any) {
	return {
		createUser: async (user: any) => {
			const [created] = await db.insert(schema.users).values(user).returning();
			return created;
		},
		getUserByEmail: async (email: string) => {
			return await db.query.users.findFirst({
				where: (userTable: any, { eq }: any) => eq(userTable.email, email),
			});
		},
		getUserById: async (id: string) => {
			return await db.query.users.findFirst({
				where: (userTable: any, { eq }: any) => eq(userTable.id, id),
			});
		},
		updateUser: async (id: string, data: any) => {
			const [updated] = await db
				.update(schema.users)
				.set(data)
				.where(eq(schema.users.id, id))
				.returning();
			return updated;
		},
		deleteUser: async (id: string) => {
			await db.delete(schema.users).where(eq(schema.users.id, id));
		},
		createSession: async (session: any) => {
			const [created] = await db
				.insert(schema.sessions)
				.values(session)
				.returning();
			return created;
		},
		getSession: async (token: string) => {
			return await db.query.sessions.findFirst({
				where: (sessionTable: any, { eq }: any) =>
					eq(sessionTable.sessionToken, token),
			});
		},
		updateSession: async (token: string, data: any) => {
			const [updated] = await db
				.update(schema.sessions)
				.set(data)
				.where(eq(schema.sessions.sessionToken, token))
				.returning();
			return updated;
		},
		deleteSession: async (token: string) => {
			await db
				.delete(schema.sessions)
				.where(eq(schema.sessions.sessionToken, token));
		},
		createAccount: async (account: any) => {
			const [created] = await db
				.insert(schema.accounts)
				.values(account)
				.returning();
			return created;
		},
		getAccount: async (provider: string, providerAccountId: string) => {
			return await db.query.accounts.findFirst({
				where: (accountTable: any, { eq, and }: any) =>
					and(
						eq(accountTable.provider, provider),
						eq(accountTable.providerAccountId, providerAccountId)
					),
			});
		},
		updateAccount: async (
			provider: string,
			providerAccountId: string,
			data: any
		) => {
			const [updated] = await db
				.update(schema.accounts)
				.set(data)
				.where(
					and(
						eq(schema.accounts.provider, provider),
						eq(schema.accounts.providerAccountId, providerAccountId)
					)
				)
				.returning();
			return updated;
		},
		deleteAccount: async (provider: string, providerAccountId: string) => {
			await db
				.delete(schema.accounts)
				.where(
					and(
						eq(schema.accounts.provider, provider),
						eq(schema.accounts.providerAccountId, providerAccountId)
					)
				);
		},
	};
}

export const auth = betterAuth({
	database: createDrizzleAdapter(db, schema),
	baseURL: `${env.CORS_ORIGIN}/api/auth`,
	secret: env.JWT_SECRET,
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 minutes
		},
	},
});
