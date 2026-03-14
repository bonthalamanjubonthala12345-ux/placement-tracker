<?php
require __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if (strpos($path, '/api/') !== 0) {
    send_json(['error' => 'Not found'], 404);
}

$route = substr($path, 5);
$route = trim($route, '/');
$parts = $route === '' ? [] : explode('/', $route);

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    if ($route === 'health' && $method === 'GET') {
        send_json([
            'ok' => true,
            'timestamp' => now_iso(),
            'dbState' => 1
        ]);
    }

    if ($route === 'auth/signup' && $method === 'POST') {
        $body = json_input();
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');

        if (mb_strlen($username) < USERNAME_MIN) {
            send_json(['error' => 'Username must be at least 3 characters.'], 400);
        }
        if (mb_strlen($password) < PASSWORD_MIN) {
            send_json(['error' => 'Password must be at least 4 characters.'], 400);
        }

        $usernameKey = mb_strtolower($username);
        $stmt = db()->prepare('SELECT id FROM users WHERE username_key = :key LIMIT 1');
        $stmt->execute([':key' => $usernameKey]);
        if ($stmt->fetch()) {
            send_json(['error' => 'Username already exists.'], 409);
        }

        $hash = password_hash($password, PASSWORD_BCRYPT);
        $createdAt = now_iso();
        $stmt = db()->prepare('INSERT INTO users (username, username_key, password_hash, created_at) VALUES (:u, :k, :h, :c)');
        $stmt->execute([
            ':u' => $username,
            ':k' => $usernameKey,
            ':h' => $hash,
            ':c' => $createdAt
        ]);

        $userId = (int)db()->lastInsertId();
        $token = generate_token();
        $stmt = db()->prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (:t, :uid, :c)');
        $stmt->execute([':t' => $token, ':uid' => $userId, ':c' => $createdAt]);

        send_json([
            'token' => $token,
            'user' => sanitize_user([
                'id' => $userId,
                'username' => $username,
                'created_at' => $createdAt
            ])
        ], 201);
    }

    if ($route === 'auth/login' && $method === 'POST') {
        $body = json_input();
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');

        $stmt = db()->prepare('SELECT id, username, password_hash, created_at FROM users WHERE username_key = :k LIMIT 1');
        $stmt->execute([':k' => mb_strtolower($username)]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            send_json(['error' => 'Invalid username or password.'], 401);
        }

        $token = generate_token();
        $createdAt = now_iso();
        $stmt = db()->prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (:t, :uid, :c)');
        $stmt->execute([':t' => $token, ':uid' => $user['id'], ':c' => $createdAt]);

        send_json([
            'token' => $token,
            'user' => sanitize_user($user)
        ]);
    }

    if ($route === 'auth/logout' && $method === 'POST') {
        $session = require_auth();
        $stmt = db()->prepare('DELETE FROM sessions WHERE token = :t');
        $stmt->execute([':t' => $session['token']]);
        send_json(['ok' => true]);
    }

    if ($route === 'auth/me' && $method === 'GET') {
        $session = require_auth();
        $stmt = db()->prepare('SELECT id, username, created_at FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $session['user_id']]);
        $user = $stmt->fetch();
        if (!$user) {
            $stmt = db()->prepare('DELETE FROM sessions WHERE token = :t');
            $stmt->execute([':t' => $session['token']]);
            send_json(['error' => 'Unauthorized'], 401);
        }
        send_json(['user' => sanitize_user($user)]);
    }

    if ($route === 'problems' && $method === 'GET') {
        $session = require_auth();
        $stmt = db()->prepare('SELECT * FROM problems WHERE user_id = :uid ORDER BY datetime(created_at) DESC');
        $stmt->execute([':uid' => $session['user_id']]);
        $rows = $stmt->fetchAll();
        $items = array_map('serialize_problem', $rows ?: []);
        send_json(['problems' => $items]);
    }

    if ($route === 'problems' && $method === 'POST') {
        $session = require_auth();
        $body = json_input();
        $name = trim((string)($body['name'] ?? ''));
        $topic = normalize_topic($body['topic'] ?? 'Arrays');
        $difficulty = trim((string)($body['difficulty'] ?? 'Easy')) ?: 'Easy';
        $status = trim((string)($body['status'] ?? 'Solved')) ?: 'Solved';
        $platform = trim((string)($body['platform'] ?? '-')) ?: '-';

        if ($name === '') {
            send_json(['error' => 'Problem name is required.'], 400);
        }

        $now = now_iso();
        $stmt = db()->prepare(
            'INSERT INTO problems (user_id, name, topic, difficulty, status, platform, created_at, updated_at)
             VALUES (:uid, :n, :t, :d, :s, :p, :c, :u)'
        );
        $stmt->execute([
            ':uid' => $session['user_id'],
            ':n' => $name,
            ':t' => $topic,
            ':d' => $difficulty,
            ':s' => $status,
            ':p' => $platform,
            ':c' => $now,
            ':u' => $now
        ]);

        $id = (int)db()->lastInsertId();
        send_json([
            'problem' => serialize_problem([
                'id' => $id,
                'name' => $name,
                'topic' => $topic,
                'difficulty' => $difficulty,
                'status' => $status,
                'platform' => $platform,
                'created_at' => $now
            ])
        ], 201);
    }

    if ($parts && $parts[0] === 'problems' && count($parts) === 2) {
        $session = require_auth();
        $problemId = (int)$parts[1];
        if ($problemId <= 0) {
            send_json(['error' => 'Problem not found.'], 404);
        }

        if ($method === 'PUT') {
            $body = json_input();
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '') {
                send_json(['error' => 'Problem name is required.'], 400);
            }
            $topic = normalize_topic($body['topic'] ?? 'Arrays');
            $difficulty = trim((string)($body['difficulty'] ?? 'Easy')) ?: 'Easy';
            $status = trim((string)($body['status'] ?? 'Solved')) ?: 'Solved';
            $platform = trim((string)($body['platform'] ?? '-')) ?: '-';

            $stmt = db()->prepare(
                'UPDATE problems SET name = :n, topic = :t, difficulty = :d, status = :s, platform = :p, updated_at = :u
                 WHERE id = :id AND user_id = :uid'
            );
            $stmt->execute([
                ':n' => $name,
                ':t' => $topic,
                ':d' => $difficulty,
                ':s' => $status,
                ':p' => $platform,
                ':u' => now_iso(),
                ':id' => $problemId,
                ':uid' => $session['user_id']
            ]);

            if ($stmt->rowCount() === 0) {
                send_json(['error' => 'Problem not found.'], 404);
            }

            $stmt = db()->prepare('SELECT * FROM problems WHERE id = :id AND user_id = :uid LIMIT 1');
            $stmt->execute([':id' => $problemId, ':uid' => $session['user_id']]);
            $row = $stmt->fetch();
            send_json(['problem' => serialize_problem($row)]);
        }

        if ($method === 'DELETE') {
            $stmt = db()->prepare('DELETE FROM problems WHERE id = :id AND user_id = :uid');
            $stmt->execute([':id' => $problemId, ':uid' => $session['user_id']]);
            send_json(['ok' => true]);
        }
    }

    if ($route === 'problems' && $method === 'DELETE') {
        $session = require_auth();
        $stmt = db()->prepare('DELETE FROM problems WHERE user_id = :uid');
        $stmt->execute([':uid' => $session['user_id']]);
        send_json(['ok' => true]);
    }

    send_json(['error' => 'Not found'], 404);
} catch (Throwable $error) {
    error_log($error->getMessage());
    send_json(['error' => 'Internal server error.'], 500);
}
