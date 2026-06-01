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

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

router.post("/api/upload/presigned-url", async (req, res) => {
  try {
    const { fileName, contentType, fileSize, userEmail } = req.body;
    const fileKey = `uploads/${Date.now()}_${fileName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300,
    });

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

// ── 파일 목록 ──────────────────────────────────────────────
router.get("/api/files", async (req, res) => {
  const [rows] = await db.query(
    `SELECT * FROM files WHERE is_deleted = FALSE ORDER BY created_at DESC`,
  );
  res.json(rows);
});

router.get("/api/files/mine", async (req, res) => {
  const { email } = req.query;
  const [rows] = await db.query(
    `SELECT * FROM files WHERE user_email = ? AND is_deleted = FALSE ORDER BY created_at DESC`,
    [email],
  );
  res.json(rows);
});

router.patch("/api/files/:id/favorite", async (req, res) => {
  await db.query(
    `UPDATE files SET is_favorite = NOT is_favorite WHERE id = ?`,
    [req.params.id],
  );
  res.json({ success: true });
});

router.get("/api/files/favorites", async (req, res) => {
  const { email } = req.query;
  const [rows] = await db.query(
    `SELECT * FROM files WHERE user_email = ? AND is_favorite = TRUE AND is_deleted = FALSE ORDER BY created_at DESC`,
    [email],
  );
  res.json(rows);
});

router.get("/api/files/recent", async (req, res) => {
  const { email } = req.query;
  const [rows] = await db.query(
    `SELECT * FROM files WHERE user_email = ? AND downloaded_at IS NOT NULL AND is_deleted = FALSE ORDER BY downloaded_at DESC LIMIT 20`,
    [email],
  );
  res.json(rows);
});

router.patch("/api/files/:id/trash", async (req, res) => {
  await db.query(`UPDATE files SET is_deleted = TRUE WHERE id = ?`, [
    req.params.id,
  ]);
  res.json({ success: true });
});

router.get("/api/files/trash", async (req, res) => {
  const { email } = req.query;
  const [rows] = await db.query(
    `SELECT * FROM files WHERE user_email = ? AND is_deleted = TRUE ORDER BY created_at DESC`,
    [email],
  );
  res.json(rows);
});

router.patch("/api/files/:id/restore", async (req, res) => {
  await db.query(`UPDATE files SET is_deleted = FALSE WHERE id = ?`, [
    req.params.id,
  ]);
  res.json({ success: true });
});

router.post("/api/folders", async (req, res) => {
  const { user_email, folder_path } = req.body;
  await db.query(
    `INSERT INTO files (user_email, file_name, s3_key, s3_region, folder_path)
     VALUES (?, '__folder__', '', 'ap-northeast-2', ?)`,
    [user_email, folder_path],
  );
  res.json({ success: true });
});

export default router;
