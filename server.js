// backend/server.js
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import mysql from "mysql2/promise"; // 1. MySQL 라이브러리 임포트
import uploadRouter from "./routes/upload.js";

dotenv.config();
const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// 2. 데이터베이스 커넥션 풀(Pool) 설정
// .env 파일에 있는 환경변수를 읽어와서 AWS RDS와 연결합니다.
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 3. 백엔드 서버가 켜질 때 RDS 연결이 잘 되는지 콘솔로 확인하는 로직
(async () => {
  try {
    const connection = await db.getConnection();
    console.log("✅ AWS RDS MySQL 데이터베이스 연결 성공!");
    connection.release(); // 테스트 후 연결 반환
  } catch (err) {
    console.error("❌ AWS RDS MySQL 연결 실패:", err.message);
    console.error(
      "💡 팁: RDS 보안그룹 인바운드 규칙에 백엔드 서버 IP/보안그룹이 열려있는지 확인하세요.",
    );
  }
})();

// 4. 회원가입 API 예시 (앞서 만든 users 테이블 구조 적용)
// 프론트엔드(HTML/React)에서 이 주소로 데이터를 보내면 DB에 저장됩니다.
app.post("/api/register", async (req, res) => {
  const { email, password_hash, nickname } = req.body;

  // 필수 값이 누락되었는지 검증
  if (!email || !password_hash || !nickname) {
    return res
      .status(400)
      .json({ error: "이메일, 비밀번호, 닉네임은 필수 항목입니다." });
  }

  try {
    const query = `INSERT INTO users (email, password_hash, nickname) VALUES (?, ?, ?)`;
    await db.query(query, [email, password_hash, nickname]);

    res.status(201).json({
      success: true,
      message: "회원가입이 성공적으로 완료되었습니다!",
    });
  } catch (error) {
    console.error("회원가입 에러:", error);

    // 이메일 중복 에러 처리 (MySQL 에러 코드 1062: Duplicate entry)
    if (error.errno === 1062) {
      return res.status(409).json({ error: "이미 가입된 이메일 주소입니다." });
    }

    res
      .status(500)
      .json({ error: "데이터베이스 저장 중 서버 에러가 발생했습니다." });
  }
});
// ==========================================
// 5. 로그인 API (새로 추가되는 부분)
// ==========================================
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  // 필수 값이 누락되었는지 검증
  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "이메일과 비밀번호를 모두 입력해주세요." });
  }

  try {
    // 1. 데이터베이스에서 해당 이메일을 가진 유저가 있는지 검색
    const query = `SELECT * FROM users WHERE email = ?`;
    const [rows] = await db.query(query, [email]);

    // 2. 가입된 이메일이 없는 경우
    if (rows.length === 0) {
      return res
        .status(401)
        .json({ error: "가입되지 않은 이메일 주소입니다." });
    }

    const user = rows[0];

    // 3. 비밀번호 대조
    // (현재는 가입할 때password_hash 필드에 넣었던 값과 사용자가 입력한 password를 비교합니다)
    if (user.password_hash !== password) {
      return res.status(401).json({ error: "비밀번호가 일치하지 않습니다." });
    }

    // 4. 로그인 성공 반환
    // 프론트엔드에서 활용할 수 있도록 유저의 닉네임과 이메일을 함께 보내줍니다.
    res.status(200).json({
      success: true,
      message: `${user.nickname}님, 환영합니다!`,
      user: {
        email: user.email,
        nickname: user.nickname,
      },
    });
  } catch (error) {
    console.error("로그인 에러:", error);
    res
      .status(500)
      .json({ error: "데이터베이스 조회 중 서버 에러가 발생했습니다." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// 📌 업로드가 성공하던 원래 구조 그대로 놔둡니다.
app.use("/", uploadRouter);

app.listen(PORT, () => {
  console.log(`🚀 백엔드 서버가 ${PORT}번 포트에서 가동 중입니다!`);
});
