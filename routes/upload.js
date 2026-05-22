// backend/routes/upload.js
import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
const router = express.Router();

// .env에 저장된 안전한 마스터 키로 S3 클라이언트 인증 장착!
const s3Client = new S3Client({
  region: "ap-northeast-2",
  credentials: {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// React가 "POST /api/upload/presigned-url"로 요청을 보내면 여기가 실행됨
router.post('/api/upload/presigned-url', async (req, res) => {
  try {
    const { fileName, contentType } = req.body; // React가 준 파일 정보 쏙 빼오기

    // S3 안의 uploads/ 폴더에 타임스탬프를 붙여 겹치지 않는 파일명(Key) 생성
    const fileKey = `uploads/${Date.now()}_${fileName}`;
    
    // "이 버킷의 이 위치에, 이런 종류의 파일을 올릴 거다"라는 명령서(Command) 작성
    const command = new PutObjectCommand({
      Bucket: "boeun-file-web-test-bucket",
      Key: fileKey,
      ContentType: contentType,
    });

    // ⭐ AWS 자격 증명 키로 서명된 5분(300초)짜리 일회용 PUT URL 생성!
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // React에게 일회용 주소(url)와 저장될 경로(key)를 기분 좋게 포장해서 리턴
    return res.status(200).json({
      url: presignedUrl,
      key: fileKey
    });
  } catch (error) {
    console.error('URL 생성 중 에러 발생:', error);
    return res.status(500).json({ message: '서버가 일회용 티켓 발행에 실패했습니다.' });
  }
});

router.post('/api/download/presigned-url', async (req, res) => {
  try {
    const { fileKey } = req.body;
    if (!fileKey) return res.status(400).json({ error: "fileKey가 누락되었습니다." });

    // 상단에 선언된 s3Client와 버킷명을 그대로 사용
    const command = new GetObjectCommand({ 
      Bucket: "boeun-file-web-test-bucket", 
      Key: fileKey 
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn: 600 });

    console.log(`✅ 다운로드 URL 발급 성공: ${fileKey}`); 
    return res.status(200).json({ url });
  } catch (error) {
    console.error("❌ 다운로드 URL 생성 실패:", error);
    return res.status(500).json({ error: error.message });
  }
});


export default router;
