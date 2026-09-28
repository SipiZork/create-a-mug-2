<?php
declare(strict_types=1);

/**
 * Közös biztonsági segédek a design-mentéshez.
 */

const SAVE_MAX_BYTES = 8 * 1024 * 1024;
const SAVE_COOLDOWN_SECONDS = 20;
const SAVE_MAX_PER_HOUR = 5;
const SAVE_MAX_PER_DAY = 15;
const SAVE_GLOBAL_MAX_PER_DAY = 250;
const SAVE_TOKEN_MIN_AGE_SECONDS = 4;
const SAVE_TOKEN_MAX_AGE_SECONDS = 1800;

function data_dir(): string
{
    $dir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function ensure_protected_subdir(string $name): string
{
    $dir = data_dir() . DIRECTORY_SEPARATOR . $name;
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $htaccess = $dir . DIRECTORY_SEPARATOR . '.htaccess';
    if (!is_file($htaccess)) {
        file_put_contents(
            $htaccess,
            "Options -Indexes\n<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n"
        );
    }
    return $dir;
}

function client_ip(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
}

function client_ip_hash(): string
{
    return hash('sha256', client_ip() . '|' . app_secret());
}

function app_secret(): string
{
    $path = data_dir() . DIRECTORY_SEPARATOR . 'app-secret.txt';
    if (is_file($path)) {
        $secret = trim((string) file_get_contents($path));
        if ($secret !== '') {
            return $secret;
        }
    }
    $secret = bin2hex(random_bytes(32));
    file_put_contents($path, $secret);
    @chmod($path, 0600);
    return $secret;
}

function json_read(string $path): array
{
    if (!is_file($path)) {
        return [];
    }
    $raw = file_get_contents($path);
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function json_write(string $path, array $data): void
{
    file_put_contents($path, json_encode($data, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function budapest_day_key(): string
{
    $tz = new DateTimeZone('Europe/Budapest');
    return (new DateTimeImmutable('now', $tz))->format('Y-m-d');
}

function prune_timestamps(array $timestamps, int $maxAgeSeconds): array
{
    $cutoff = time() - $maxAgeSeconds;
    return array_values(array_filter(
        $timestamps,
        static fn($ts) => is_int($ts) && $ts >= $cutoff
    ));
}

/**
 * @return string|null hibaüzenet, vagy null ha OK
 */
function check_rate_limits(): ?string
{
    $rateDir = ensure_protected_subdir('rate');
    $path = $rateDir . DIRECTORY_SEPARATOR . client_ip_hash() . '.json';
    $now = time();
    $data = json_read($path);
    $saves = prune_timestamps($data['saves'] ?? [], 86400);

    $last = isset($data['last']) && is_int($data['last']) ? $data['last'] : 0;
    if ($last > 0 && ($now - $last) < SAVE_COOLDOWN_SECONDS) {
        $wait = SAVE_COOLDOWN_SECONDS - ($now - $last);
        return "Túl gyors egymás utáni mentés. Várj még {$wait} másodpercet.";
    }

    $hourCount = count(array_filter($saves, static fn($ts) => $ts >= $now - 3600));
    if ($hourCount >= SAVE_MAX_PER_HOUR) {
        return 'Óránként legfeljebb ' . SAVE_MAX_PER_HOUR . ' design menthető erről a címről.';
    }

    if (count($saves) >= SAVE_MAX_PER_DAY) {
        return 'Naponta legfeljebb ' . SAVE_MAX_PER_DAY . ' design menthető erről a címről.';
    }

    $globalPath = $rateDir . DIRECTORY_SEPARATOR . 'global-' . budapest_day_key() . '.json';
    $global = json_read($globalPath);
    $globalCount = isset($global['count']) && is_int($global['count']) ? $global['count'] : 0;
    if ($globalCount >= SAVE_GLOBAL_MAX_PER_DAY) {
        return 'Ma elérte a szerver a napi mentési limitet. Próbáld holnap, vagy írj nekünk.';
    }

    return null;
}

function record_successful_save(): void
{
    $rateDir = ensure_protected_subdir('rate');
    $path = $rateDir . DIRECTORY_SEPARATOR . client_ip_hash() . '.json';
    $now = time();
    $data = json_read($path);
    $saves = prune_timestamps($data['saves'] ?? [], 86400);
    $saves[] = $now;
    json_write($path, [
        'last' => $now,
        'saves' => $saves,
    ]);

    $globalPath = $rateDir . DIRECTORY_SEPARATOR . 'global-' . budapest_day_key() . '.json';
    $global = json_read($globalPath);
    $count = isset($global['count']) && is_int($global['count']) ? $global['count'] : 0;
    json_write($globalPath, ['count' => $count + 1]);
}

function issue_save_token(): string
{
    $tokenDir = ensure_protected_subdir('tokens');
    $token = bin2hex(random_bytes(24));
    $path = $tokenDir . DIRECTORY_SEPARATOR . $token . '.json';
    json_write($path, [
        'ip' => client_ip_hash(),
        'created' => time(),
        'used' => false,
    ]);
    return $token;
}

/**
 * @return string|null hibaüzenet, vagy null ha OK
 */
function consume_save_token(?string $token): ?string
{
    if ($token === null || $token === '' || !preg_match('/^[a-f0-9]{48}$/', $token)) {
        return 'Érvénytelen mentési token. Frissítsd az oldalt, és próbáld újra.';
    }

    $path = ensure_protected_subdir('tokens') . DIRECTORY_SEPARATOR . $token . '.json';
    if (!is_file($path)) {
        return 'A mentési token lejárt vagy már felhasználták. Próbáld újra.';
    }

    $data = json_read($path);
    @unlink($path);

    if (!empty($data['used'])) {
        return 'A mentési token már fel lett használva.';
    }

    $created = isset($data['created']) && is_int($data['created']) ? $data['created'] : 0;
    $age = time() - $created;
    if ($age < SAVE_TOKEN_MIN_AGE_SECONDS) {
        return 'Túl gyors mentési kísérlet. Várj egy pillanatot, majd próbáld újra.';
    }
    if ($age > SAVE_TOKEN_MAX_AGE_SECONDS) {
        return 'A mentési token lejárt. Próbáld újra.';
    }

    if (($data['ip'] ?? '') !== client_ip_hash()) {
        return 'A mentési token nem ehhez a munkamenethez tartozik.';
    }

    return null;
}

function cleanup_old_tokens(int $maxAge = SAVE_TOKEN_MAX_AGE_SECONDS): void
{
    $dir = ensure_protected_subdir('tokens');
    $cutoff = time() - $maxAge;
    foreach (glob($dir . DIRECTORY_SEPARATOR . '*.json') ?: [] as $file) {
        $data = json_read($file);
        $created = isset($data['created']) && is_int($data['created']) ? $data['created'] : 0;
        if ($created < $cutoff) {
            @unlink($file);
        }
    }
}
