import { Router } from "express";
import { and, asc, desc, eq, ilike, ne, or } from "drizzle-orm";
import { getSecureDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { sanitizeInput } from "../lib/security.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
	try {
		const search =
			typeof req.query.search === "string"
				? sanitizeInput(req.query.search)
				: undefined;
		const rawLimit =
			typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
		const limit = Number.isNaN(rawLimit) ? 20 : Math.min(rawLimit, 100);

		const secureDb = getSecureDb(req.user!.id);

		let whereClause: any = ne(users.id, req.user!.id);

		if (search) {
			const pattern = `%${search}%`;
			whereClause = and(
				whereClause,
				or(ilike(users.username, pattern), ilike(users.email, pattern))
			);
		}

		const result = await secureDb.withRLS((tx) =>
			tx
				.select({
					id: users.id,
					username: users.username,
					email: users.email,
					avatar: users.avatar,
					status: users.status,
					isOnline: users.isOnline,
					lastSeen: users.lastSeen,
				})
				.from(users)
				.where(whereClause)
				.orderBy(desc(users.isOnline), asc(users.username))
				.limit(limit)
		);

		return res.json({ users: result });
	} catch (error) {
		return res.status(500).json({ error: "Failed to fetch users" });
	}
});

router.get("/me", requireAuth, async (req, res) => {
	const secureDb = getSecureDb(req.user!.id);
	const user = await secureDb.withRLS((tx) =>
		tx
			.select({
				id: users.id,
				username: users.username,
				email: users.email,
				avatar: users.avatar,
				status: users.status,
				isOnline: users.isOnline,
				lastSeen: users.lastSeen,
				createdAt: users.createdAt,
			})
			.from(users)
			.where(eq(users.id, req.user!.id))
			.limit(1)
	);

	if (user.length === 0) {
		return res.status(404).json({ error: "User not found" });
	}

	return res.json({ user: user[0] });
});

export default router;
