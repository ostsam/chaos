import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";
import { env } from "./config/env.js";
import apiRouter from "./routes/index.js";
import { authenticate } from "./middleware/auth.js";
import { notFound, errorHandler } from "./middleware/error-handler.js";
import { registerChatSocket } from "./sockets/chat.js";

const app = express();
const server = createServer(app);

const allowedOrigins: string[] = env.CORS_ORIGIN.split(",").map((origin) =>
	origin.trim()
);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (env.NODE_ENV !== "production") {
	app.use(morgan("dev"));
}

app.use(authenticate);

app.get("/health", (_req, res) => {
	res.json({ status: "ok" });
});

app.use("/api", apiRouter);

app.use(notFound);
app.use(errorHandler);

const io = new Server(server, {
	cors: {
		origin: allowedOrigins,
		methods: ["GET", "POST"],
		credentials: true,
	},
});

registerChatSocket(io);

server.listen(env.PORT, () => {
	console.log(`HTTP server listening on port ${env.PORT}`);
});

export { app, server };
