<?php
declare(strict_types=1);

require __DIR__ . '/security.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Csak GET kérés engedélyezett.']);
    exit;
}

cleanup_old_tokens();

$rateError = check_rate_limits();
if ($rateError !== null) {
    // Token még adható, de jelezzük a kliensnek, hogy mentésnél úgyis elutasítjuk.
    // Itt azért nem blokkolunk teljesen, hogy a UI üzenetet tudjon mutatni mentéskor.
}

$token = issue_save_token();

echo json_encode([
    'ok' => true,
    'token' => $token,
    'minWaitSeconds' => SAVE_TOKEN_MIN_AGE_SECONDS,
], JSON_UNESCAPED_UNICODE);
