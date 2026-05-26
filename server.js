// backend/server.js
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import uploadRouter from "./routes/upload.js";

dotenv.config();
const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// 📌 업로드가 성공하던 원래 구조 그대로 놔둡니다.
app.use("/", uploadRouter);

app.listen(PORT, () => {
  console.log(`🚀 백엔드 서버가 ${PORT}번 포트에서 가동 중입니다!`);
});
