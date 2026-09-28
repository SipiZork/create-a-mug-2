<?php
declare(strict_types=1);

require __DIR__ . '/security.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Csak POST kérés engedélyezett.']);
    exit;
}

const CODE_RANDOM_LENGTH = 14;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function respond_error(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function generate_code(string $dir): string
{
    $timezone = new DateTimeZone('Europe/Budapest');
    $datePrefix = (new DateTimeImmutable('now', $timezone))->format('md');
    $alphabet = CODE_ALPHABET;
    $max = strlen($alphabet) - 1;

    for ($attempt = 0; $attempt < 20; $attempt++) {
        $random = '';
        for ($i = 0; $i < CODE_RANDOM_LENGTH; $i++) {
            $random .= $alphabet[random_int(0, $max)];
        }
        $code = $datePrefix . '-' . $random;
        if (!file_exists($dir . DIRECTORY_SEPARATOR . $code . '.png')) {
            return $code;
        }
    }

    respond_error(500, 'Nem sikerült egyedi kódot generálni.');
}

// Honeypot: emberek üresen hagyják, botok gyakran kitöltik
$honeypot = trim((string) ($_POST['company_url'] ?? ''));
if ($honeypot !== '') {
    // Úgy teszünk, mintha sikerült volna — botoknak ne adjunk visszajelzést
    echo json_encode([
        'ok' => true,
        'code' => '0000-HONEYPOTBLOCKEDX',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$tokenError = consume_save_token(isset($_POST['save_token']) ? (string) $_POST['save_token'] : null);
if ($tokenError !== null) {
    respond_error(403, $tokenError);
}

$rateError = check_rate_limits();
if ($rateError !== null) {
    respond_error(429, $rateError);
}

if (!isset($_FILES['design']) || !is_array($_FILES['design'])) {
    respond_error(400, 'Hiányzó design fájl.');
}

$file = $_FILES['design'];

if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    respond_error(400, 'A feltöltés sikertelen.');
}

if (($file['size'] ?? 0) <= 0 || $file['size'] > SAVE_MAX_BYTES) {
    respond_error(400, 'Érvénytelen fájlméret (max. 8 MB).');
}

$tmp = $file['tmp_name'] ?? '';
if ($tmp === '' || !is_uploaded_file($tmp)) {
    respond_error(400, 'Érvénytelen feltöltés.');
}

$info = @getimagesize($tmp);
if ($info === false || ($info[2] ?? null) !== IMAGETYPE_PNG) {
    respond_error(400, 'Csak érvényes PNG kép fogadható.');
}

// Minimális „valódi kép” elvárás: ne fogadjunk el 1×1 spam PNG-t
$width = (int) ($info[0] ?? 0);
$height = (int) ($info[1] ?? 0);
if ($width < 100 || $height < 40) {
    respond_error(400, 'A kép mérete túl kicsi a mentéshez.');
}

$dir = __DIR__ . DIRECTORY_SEPARATOR . 'designs';
if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
    respond_error(500, 'A mentési mappa nem hozható létre.');
}

$code = generate_code($dir);
$target = $dir . DIRECTORY_SEPARATOR . $code . '.png';

if (!move_uploaded_file($tmp, $target)) {
    respond_error(500, 'A fájl mentése sikertelen.');
}

@chmod($target, 0644);
record_successful_save();

echo json_encode([
    'ok' => true,
    'code' => $code,
], JSON_UNESCAPED_UNICODE);
