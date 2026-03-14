<?php
// DB + helper utilities for the Placement Tracker (SQLite).

define('DB_PATH', __DIR__ . '/data/placement.db');

define('TOKEN_BYTES', 32);

define('USERNAME_MIN', 3);

define('PASSWORD_MIN', 4);

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dir = dirname(DB_PATH);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    $pdo->exec('PRAGMA foreign_keys = ON;');

    $pdo->exec('
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            username_key TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    ');

    $pdo->exec('
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ');

    $pdo->exec('
        CREATE TABLE IF NOT EXISTS problems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            topic TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            status TEXT NOT NULL,
            platform TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ');

    return $pdo;
}

function json_input(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function send_json($payload, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload);
    exit;
}

function auth_header(): string {
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return trim($_SERVER['HTTP_AUTHORIZATION']);
    }
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (!empty($headers['Authorization'])) {
            return trim($headers['Authorization']);
        }
    }
    return '';
}

function require_auth(): array {
    $header = auth_header();
    $token = '';
    if (stripos($header, 'Bearer ') === 0) {
        $token = trim(substr($header, 7));
    }
    if ($token === '') {
        send_json(['error' => 'Unauthorized'], 401);
    }

    $stmt = db()->prepare('SELECT id, user_id FROM sessions WHERE token = :token LIMIT 1');
    $stmt->execute([':token' => $token]);
    $session = $stmt->fetch();
    if (!$session) {
        send_json(['error' => 'Unauthorized'], 401);
    }

    return ['token' => $token, 'user_id' => (int)$session['user_id']];
}

function sanitize_user(array $row): array {
    return [
        'id' => (string)$row['id'],
        'username' => $row['username'],
        'createdAt' => $row['created_at'],
    ];
}

function serialize_problem(array $row): array {
    return [
        'id' => (string)$row['id'],
        'name' => $row['name'],
        'topic' => $row['topic'],
        'difficulty' => $row['difficulty'],
        'status' => $row['status'],
        'platform' => $row['platform'],
        'createdAt' => $row['created_at'],
    ];
}

function now_iso(): string {
    return gmdate('c');
}

function generate_token(): string {
    return bin2hex(random_bytes(TOKEN_BYTES));
}

function normalize_topic($value): string {
    $topic = trim((string)$value);
    return $topic !== '' ? $topic : 'Arrays';
}
?>
