// Client-side authentication helper for better-auth
const API_BASE = "/api";

export interface User {
	id: string;
	email: string;
	username: string;
	avatar?: string;
	status: string;
	isOnline: boolean;
	lastSeen: string;
}

export interface AuthResponse {
	user: User;
}

export interface LoginCredentials {
	email: string;
	password: string;
}

export interface RegisterCredentials {
	email: string;
	username: string;
	password: string;
}

class AuthClient {
	private baseURL: string;

	constructor(baseURL: string = API_BASE) {
		this.baseURL = baseURL;
	}

	async login(credentials: LoginCredentials): Promise<AuthResponse> {
		const response = await fetch(`${this.baseURL}/auth/login`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			credentials: "include",
			body: JSON.stringify(credentials),
		});

		if (!response.ok) {
			const error = await response
				.json()
				.catch(() => ({ error: "Login failed" }));
			throw new Error(error.error || "Login failed");
		}

		return response.json();
	}

	async register(credentials: RegisterCredentials): Promise<AuthResponse> {
		const response = await fetch(`${this.baseURL}/auth/register`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			credentials: "include",
			body: JSON.stringify(credentials),
		});

		if (!response.ok) {
			const error = await response
				.json()
				.catch(() => ({ error: "Registration failed" }));
			throw new Error(error.error || "Registration failed");
		}

		return response.json();
	}

	async logout(): Promise<void> {
		const response = await fetch(`${this.baseURL}/auth/logout`, {
			method: "POST",
			credentials: "include",
		});

		if (!response.ok) {
			const error = await response
				.json()
				.catch(() => ({ error: "Logout failed" }));
			throw new Error(error.error || "Logout failed");
		}
	}

	async getCurrentUser(): Promise<User | null> {
		try {
			const response = await fetch(`${this.baseURL}/auth/me`, {
				credentials: "include",
			});

			if (!response.ok) {
				return null;
			}

			const data = await response.json();
			return data.user;
		} catch (error) {
			return null;
		}
	}

	async refreshSession(): Promise<User | null> {
		// Try to get current user to refresh/validate session
		return this.getCurrentUser();
	}

	// Helper to check if user is authenticated
	async isAuthenticated(): Promise<boolean> {
		const user = await this.getCurrentUser();
		return user !== null;
	}

	// Get session token from cookies or localStorage
	getSessionToken(): string | null {
		// Try to get from cookies first, then localStorage
		return (
			document.cookie
				.split("; ")
				.find((row) => row.startsWith("sessionToken="))
				?.split("=")[1] || null
		);
	}

	// Store session token
	setSessionToken(token: string): void {
		// Store in localStorage as fallback
		localStorage.setItem("sessionToken", token);
	}

	// Clear session
	clearSession(): void {
		localStorage.removeItem("sessionToken");
		// Clear any auth cookies by setting expired date
		document.cookie =
			"sessionToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
	}
}

// Export singleton instance
export const authClient = new AuthClient();

// Export types
export type { AuthClient };
