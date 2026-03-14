const express = require("express");
const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/placement_tracker";

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

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    usernameKey: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

const sessionSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

const problemSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    topic: { type: String, default: "Arrays" },
    difficulty: { type: String, default: "Easy" },
    status: { type: String, default: "Solved" },
    platform: { type: String, default: "-" }
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

const User = mongoose.model("User", userSchema);
const Session = mongoose.model("Session", sessionSchema);
const Problem = mongoose.model("Problem", problemSchema);

async function ensureDbConnection() {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  await mongoose.connect(MONGODB_URI);
}

function sanitizeUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    createdAt: user.createdAt
  };
}

function serializeProblem(problem) {
  return {
    id: String(problem._id),
    name: problem.name,
    topic: problem.topic,
    difficulty: problem.difficulty,
    status: problem.status,
    platform: problem.platform,
    createdAt: problem.createdAt
  };
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeTopic(topic) {
  const value = String(topic || "Arrays").trim();
  return value || "Arrays";
}

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal server error." });
    }
  };
}

async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";

    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const session = await Session.findOne({ token }).lean();
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.userId = String(session.userId);
    req.token = token;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error." });
  }
}

app.post(
  "/api/auth/signup",
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
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

    const usernameKey = username.toLowerCase();
    const exists = await User.findOne({ usernameKey }).lean();
    if (exists) {
      res.status(409).json({ error: "Username already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, usernameKey, passwordHash });

    const token = generateToken();
    await Session.create({ token, userId: user._id });

    res.status(201).json({ token, user: sanitizeUser(user) });
  })
);

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    const user = await User.findOne({ usernameKey: username.toLowerCase() });
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
    await Session.create({ token, userId: user._id });

    res.json({ token, user: sanitizeUser(user) });
  })
);

app.post(
  "/api/auth/logout",
  authMiddleware,
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
    await Session.deleteOne({ token: req.token });
    res.json({ ok: true });
  })
);

app.get(
  "/api/auth/me",
  authMiddleware,
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
    const user = await User.findById(req.userId);
    if (!user) {
      await Session.deleteOne({ token: req.token });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.json({ user: sanitizeUser(user) });
  })
);

app.get(
  "/api/problems",
  authMiddleware,
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
    const problems = await Problem.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ problems: problems.map(serializeProblem) });
  })
);

app.post(
  "/api/problems",
  authMiddleware,
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
    const name = String(req.body?.name || "").trim();
    const topic = normalizeTopic(req.body?.topic);
    const difficulty = String(req.body?.difficulty || "Easy").trim() || "Easy";
    const status = String(req.body?.status || "Solved").trim() || "Solved";
    const platform = String(req.body?.platform || "-").trim() || "-";

    if (!name) {
      res.status(400).json({ error: "Problem name is required." });
      return;
    }

    const problem = await Problem.create({
      userId: req.userId,
      name,
      topic,
      difficulty,
      status,
      platform
    });

    res.status(201).json({ problem: serializeProblem(problem) });
  })
);

app.put(
  "/api/problems/:id",
  authMiddleware,
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
    const problemId = String(req.params.id || "");
    const name = String(req.body?.name || "").trim();

    if (!name) {
      res.status(400).json({ error: "Problem name is required." });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(problemId)) {
      res.status(404).json({ error: "Problem not found." });
      return;
    }

    const problem = await Problem.findOne({ _id: problemId, userId: req.userId });
    if (!problem) {
      res.status(404).json({ error: "Problem not found." });
      return;
    }

    problem.name = name;
    problem.topic = normalizeTopic(req.body?.topic || problem.topic);
    problem.difficulty = String(req.body?.difficulty || problem.difficulty).trim() || "Easy";
    problem.status = String(req.body?.status || problem.status).trim() || "Solved";
    problem.platform = String(req.body?.platform || "-").trim() || "-";
    await problem.save();

    res.json({ problem: serializeProblem(problem) });
  })
);

app.delete(
  "/api/problems/:id",
  authMiddleware,
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
    const problemId = String(req.params.id || "");

    if (!mongoose.Types.ObjectId.isValid(problemId)) {
      res.json({ ok: true });
      return;
    }

    await Problem.deleteOne({ _id: problemId, userId: req.userId });
    res.json({ ok: true });
  })
);

app.delete(
  "/api/problems",
  authMiddleware,
  asyncHandler(async (req, res) => {
    await ensureDbConnection();
    await Problem.deleteMany({ userId: req.userId });
    res.json({ ok: true });
  })
);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    dbState: mongoose.connection.readyState
  });
});

async function start() {
  await ensureDbConnection();
  app.listen(PORT, () => {
    console.log(`Placement tracker backend running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}

module.exports = app;
