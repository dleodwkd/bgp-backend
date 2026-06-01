import dotenv from "dotenv";
dotenv.config();

import express from "express";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import mysql from "mysql2/promise";

const router = express.Router();

const s3Client = new S3Client({
  region: "ap-northeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// server.js와 동일한 풀 설정
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

// ── 업로드 presigned URL 발급 ──────────────────────────────
router.post("/api/upload/presigned-url", async (req, res) => {
  try {
    const { fileName, contentType, fileSize, userEmail } = req.body; // userEmail 추가

    const fileKey = `uploads/${Date.now()}_${fileName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300,
    });

    // ✅ S3 업로드 전에 DB에 메타데이터 저장
    await db.query(
      `INSERT INTO files (user_email, file_name, s3_key, s3_region, file_size)
       VALUES (?, ?, ?, 'ap-northeast-2', ?)`,
      [userEmail || "guest@example.com", fileName, fileKey, fileSize || 0],
    );

    console.log(`✅ 파일 메타데이터 DB 저장 완료: ${fileName}`);

    return res.status(200).json({ url: presignedUrl, key: fileKey });
  } catch (error) {
    console.error("URL 생성 중 에러 발생:", error);
    return res
      .status(500)
      .json({ message: "서버가 일회용 티켓 발행에 실패했습니다." });
  }
});

// ── 다운로드 presigned URL 발급 + downloaded_at 업데이트 ──
router.post("/api/download/presigned-url", async (req, res) => {
  try {
    const { fileKey, fileId } = req.body;
    if (!fileKey)
      return res.status(400).json({ error: "fileKey가 누락되었습니다." });

    const command = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: fileKey,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 600 });

    // ✅ 다운로드 시각 기록
    if (fileId) {
      await db.query(`UPDATE files SET downloaded_at = NOW() WHERE id = ?`, [
        fileId,
      ]);
    }

    console.log(`✅ 다운로드 URL 발급 성공: ${fileKey}`);
    return res.status(200).json({ url });
  } catch (error) {
    console.error("❌ 다운로드 URL 생성 실패:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ── 3. 파일 목록 (전체 공유 파일) ──────────────────────────
app.get("/api/files", async (req, res) => {
  const [rows] = await db.query(
    `SELECT * FROM files WHERE is_deleted = FALSE ORDER BY created_at DESC`,
  );
  res.json(rows);
});

// ── 4-1. 내 파일 ────────────────────────────────────────────
app.get("/api/files/mine", async (req, res) => {
  const { email } = req.query;
  const [rows] = await db.query(
    `SELECT * FROM files 
     WHERE user_email = ? AND is_deleted = FALSE 
     ORDER BY created_at DESC`,
    [email],
  );
  res.json(rows);
});

// ── 4-2. 즐겨찾기 토글 ─────────────────────────────────────
app.patch("/api/files/:id/favorite", async (req, res) => {
  await db.query(
    `UPDATE files SET is_favorite = NOT is_favorite WHERE id = ?`,
    [req.params.id],
  );
  res.json({ success: true });
});

// ── 4-2. 즐겨찾기 목록 ─────────────────────────────────────
app.get("/api/files/favorites", async (req, res) => {
  const { email } = req.query;
  const [rows] = await db.query(
    `SELECT * FROM files 
     WHERE user_email = ? AND is_favorite = TRUE AND is_deleted = FALSE 
     ORDER BY created_at DESC`,
    [email],
  );
  res.json(rows);
});

// ── 4-3. 최근 항목 ──────────────────────────────────────────
app.get("/api/files/recent", async (req, res) => {
  const { email } = req.query;
  const [rows] = await db.query(
    `SELECT * FROM files 
     WHERE user_email = ? AND downloaded_at IS NOT NULL AND is_deleted = FALSE
     ORDER BY downloaded_at DESC LIMIT 20`,
    [email],
  );
  res.json(rows);
});

// ── 5. 휴지통 (soft delete) ─────────────────────────────────
app.patch("/api/files/:id/trash", async (req, res) => {
  await db.query(`UPDATE files SET is_deleted = TRUE WHERE id = ?`, [
    req.params.id,
  ]);
  res.json({ success: true });
});

// 휴지통 목록
app.get("/api/files/trash", async (req, res) => {
  const { email } = req.query;
  const [rows] = await db.query(
    `SELECT * FROM files WHERE user_email = ? AND is_deleted = TRUE ORDER BY created_at DESC`,
    [email],
  );
  res.json(rows);
});

// 휴지통에서 복원
app.patch("/api/files/:id/restore", async (req, res) => {
  await db.query(`UPDATE files SET is_deleted = FALSE WHERE id = ?`, [
    req.params.id,
  ]);
  res.json({ success: true });
});

// ── 6. 폴더 생성 ────────────────────────────────────────────
app.post("/api/folders", async (req, res) => {
  const { user_email, folder_path } = req.body;
  await db.query(
    `INSERT INTO files (user_email, file_name, s3_key, s3_region, folder_path)
     VALUES (?, '__folder__', '', 'ap-northeast-2', ?)`,
    [user_email, folder_path],
  );
  res.json({ success: true });
});

export default router;
