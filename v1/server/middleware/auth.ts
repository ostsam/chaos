import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/auth.js";

export interface AuthenticatedUser {
	id: string;
	email: string;
	username: string;
}

declare global {
	namespace Express {
		interface Request {
			user?: AuthenticatedUser;
		}
	}
}

export async function authenticate(
	req: Request,
	_res: Response,
	next: NextFunction
) {
	try {
		const sessionToken =
			req.headers.authorization?.replace("Bearer ", "") ||
			req.cookies?.sessionToken;

		if (!sessionToken) {
			return next();
		}

		const result = await (auth.api.getSession as any)({
			headers: {
				authorization: `Bearer ${sessionToken}`,
			},
		});

		if (result && result.data && result.data.user) {
			// Get user details from database
			const user = result.data.user;

			req.user = {
				id: user.id,
				email: user.email,
				username: user.name || user.email, // fallback to email if no name
			};
		} else {
			return next();
		}
	} catch (error) {
		console.error("Authentication error:", error);
		// Don't fail the request, just don't set user
	}

	return next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
	if (!req.user) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	return next();
}
