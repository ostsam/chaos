import { Router } from "express";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import chatsRouter from "./chats.js";
import messagesRouter from "./messages.js";
import uploadRouter from "./upload.js";
import filesRouter from "./files.js";

const router = Router();

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/chats", chatsRouter);
router.use("/messages", messagesRouter);
router.use("/upload", uploadRouter);
router.use("/files", filesRouter);

export default router;
