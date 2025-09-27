import { Router } from "express";
import { auth } from "../lib/auth.js";
import { getSecureDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// Better Auth handlers
router.post("/register", async (req, res) => {
	try {
		const { email, username, password } = req.body;

		if (!email || !username || !password) {
			return res
				.status(400)
				.json({ error: "Email, username, and password are required" });
		}

		const result = await (auth.api.signUpEmail as any)({
			body: {
				email,
				password,
				name: username, // better-auth uses name instead of username
				// We'll store username separately
			},
		});

		if (result && result.error) {
			return res.status(400).json({ error: result.error });
		}

		if (!result || !result.data || !result.data.user) {
			return res.status(500).json({ error: "Registration failed" });
		}

		// Update the user with the username
		const secureDb = getSecureDb(result.data.user.id);
		await secureDb.withRLS((tx) =>
			tx
				.update(users)
				.set({ username })
				.where(eq(users.id, result.data.user.id))
		);

		return res.status(201).json({
			user: {
				id: result.data.user.id,
				email: result.data.user.email,
				username: username,
				avatar: result.data.user.image,
				status: "Hey there! I am using WhatsApp.",
				isOnline: true,
				lastSeen: new Date(),
			},
		});
	} catch (error) {
		console.error("Registration error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
});

router.post("/login", async (req, res) => {
	try {
		const { email, password } = req.body;

		if (!email || !password) {
			return res.status(400).json({ error: "Email and password are required" });
		}

		const result = await (auth.api.signInEmail as any)({
			body: {
				email,
				password,
			},
		});

		if (result && result.error) {
			return res.status(401).json({ error: "Invalid credentials" });
		}

		if (!result || !result.data || !result.data.user) {
			return res.status(500).json({ error: "Login failed" });
		}

		// Update user online status
		const secureDb = getSecureDb(result.data.user.id);
		await secureDb.withRLS((tx) =>
			tx
				.update(users)
				.set({
					isOnline: true,
					lastSeen: new Date(),
				})
				.where(eq(users.id, result.data.user.id))
		);

		return res.json({
			user: {
				id: result.data.user.id,
				email: result.data.user.email,
				username: result.data.user.name, // better-auth uses name
				avatar: result.data.user.image,
				status: "Hey there! I am using WhatsApp.",
				isOnline: true,
				lastSeen: new Date(),
			},
		});
	} catch (error) {
		console.error("Login error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
});

router.post("/logout", async (req, res) => {
	try {
		const sessionToken = req.headers.authorization?.replace("Bearer ", "");

		if (!sessionToken) {
			return res.status(401).json({ error: "No session token provided" });
		}

		const result = await (auth.api.signOut as any)({
			headers: {
				authorization: `Bearer ${sessionToken}`,
			},
		});

		if (result && result.error) {
			return res.status(400).json({ error: result.error });
		}

		// Update user offline status if we have user info
		if (req.user) {
			const secureDb = getSecureDb(req.user.id);
			await secureDb.withRLS((tx) =>
				tx
					.update(users)
					.set({
						isOnline: false,
						lastSeen: new Date(),
					})
					.where(eq(users.id, req.user!.id))
			);
		}

		return res.json({ success: true });
	} catch (error) {
		console.error("Logout error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
});

router.get("/me", async (req, res) => {
	try {
		const sessionToken = req.headers.authorization?.replace("Bearer ", "");

		if (!sessionToken) {
			return res.status(401).json({ error: "No session token provided" });
		}

		const result = await (auth.api.getSession as any)({
			headers: {
				authorization: `Bearer ${sessionToken}`,
			},
		});

		if (result && result.error) {
			return res.status(401).json({ error: "Invalid session" });
		}

		if (!result || !result.data || !result.data.user) {
			return res.status(401).json({ error: "Invalid session" });
		}

		const secureDb = getSecureDb(result.data.user.id);
		const user = await secureDb.withRLS((tx) =>
			tx.query.users.findFirst({
				where: (userTable, { eq }) => eq(userTable.id, result.data!.user.id),
				columns: {
					id: true,
					email: true,
					username: true,
					avatar: true,
					status: true,
					isOnline: true,
					lastSeen: true,
				},
			})
		);

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		return res.json({ user });
	} catch (error) {
		console.error("Get user error:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
});

export default router;
