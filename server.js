const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, "data.json");

app.use(express.json());
app.use(express.static(__dirname));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

function ensureDataFile() {
  if (!fs.existsSync(DATA_PATH)) {
    const initialData = {
      users: [],
      problemsByUserId: {},
      sessions: []
    };
    fs.writeFileSync(DATA_PATH, JSON.stringify(initialData, null, 2), "utf8");
  }
}

function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const parsed = JSON.parse(raw || "{}");
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    problemsByUserId:
      parsed.problemsByUserId && typeof parsed.problemsByUserId === "object"
        ? parsed.problemsByUserId
        : {},
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
  };
}

function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt
  };
}

function generateId() {
  return crypto.randomUUID();
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  const data = readData();
  const session = data.sessions.find((entry) => entry.token === token);

  if (!token || !session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = session.userId;
  req.token = token;
  next();
}

app.post("/api/auth/signup", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (username.length < 3) {
    res.status(400).json({ error: "Username must be at least 3 characters." });
    return;
  }

  if (password.length < 4) {
    res.status(400).json({ error: "Password must be at least 4 characters." });
    return;
  }

  const data = readData();
  const exists = data.users.some(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );

  if (exists) {
    res.status(409).json({ error: "Username already exists." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: generateId(),
    username,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  data.users.push(user);
  data.problemsByUserId[user.id] = [];
  writeData(data);

  const token = generateToken();
  data.sessions.push({
    token,
    userId: user.id,
    createdAt: new Date().toISOString()
  });
  writeData(data);

  res.status(201).json({ token, user: sanitizeUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  const data = readData();
  const user = data.users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );

  if (!user) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const token = generateToken();
  data.sessions.push({
    token,
    userId: user.id,
    createdAt: new Date().toISOString()
  });
  writeData(data);

  res.json({ token, user: sanitizeUser(user) });
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  const data = readData();
  data.sessions = data.sessions.filter((entry) => entry.token !== req.token);
  writeData(data);
  res.json({ ok: true });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const data = readData();
  const user = data.users.find((u) => u.id === req.userId);

  if (!user) {
    data.sessions = data.sessions.filter((entry) => entry.token !== req.token);
    writeData(data);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json({ user: sanitizeUser(user) });
});

app.get("/api/problems", authMiddleware, (req, res) => {
  const data = readData();
  const list = Array.isArray(data.problemsByUserId[req.userId])
    ? data.problemsByUserId[req.userId]
    : [];

  res.json({ problems: list });
});

app.post("/api/problems", authMiddleware, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const topic = String(req.body?.topic || "Arrays");
  const difficulty = String(req.body?.difficulty || "Easy");
  const status = String(req.body?.status || "Solved");
  const platform = String(req.body?.platform || "-").trim() || "-";

  if (!name) {
    res.status(400).json({ error: "Problem name is required." });
    return;
  }

  const data = readData();
  const list = Array.isArray(data.problemsByUserId[req.userId])
    ? data.problemsByUserId[req.userId]
    : [];

  const problem = {
    id: generateId(),
    name,
    topic,
    difficulty,
    status,
    platform,
    createdAt: new Date().toISOString()
  };

  list.unshift(problem);
  data.problemsByUserId[req.userId] = list;
  writeData(data);

  res.status(201).json({ problem });
});

app.put("/api/problems/:id", authMiddleware, (req, res) => {
  const problemId = String(req.params.id || "");
  const name = String(req.body?.name || "").trim();

  if (!name) {
    res.status(400).json({ error: "Problem name is required." });
    return;
  }

  const data = readData();
  const list = Array.isArray(data.problemsByUserId[req.userId])
    ? data.problemsByUserId[req.userId]
    : [];

  const idx = list.findIndex((p) => p.id === problemId);
  if (idx === -1) {
    res.status(404).json({ error: "Problem not found." });
    return;
  }

  list[idx] = {
    ...list[idx],
    name,
    topic: String(req.body?.topic || list[idx].topic),
    difficulty: String(req.body?.difficulty || list[idx].difficulty),
    status: String(req.body?.status || list[idx].status),
    platform: String(req.body?.platform || "-").trim() || "-"
  };

  data.problemsByUserId[req.userId] = list;
  writeData(data);

  res.json({ problem: list[idx] });
});

app.delete("/api/problems/:id", authMiddleware, (req, res) => {
  const problemId = String(req.params.id || "");
  const data = readData();
  const list = Array.isArray(data.problemsByUserId[req.userId])
    ? data.problemsByUserId[req.userId]
    : [];

  const next = list.filter((p) => p.id !== problemId);
  data.problemsByUserId[req.userId] = next;
  writeData(data);

  res.json({ ok: true });
});

app.delete("/api/problems", authMiddleware, (req, res) => {
  const data = readData();
  data.problemsByUserId[req.userId] = [];
  writeData(data);
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`Placement tracker backend running on http://localhost:${PORT}`);
});
