<?php
declare(strict_types=1);

/**
 * Helyi PHP beépített szerver router:
 *   php -S localhost:8080 router.php
 *
 * Megakadályozza a /designs/ közvetlen elérését (éles Apache-n az .htaccess is védi).
 */
$uri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
$file = __DIR__ . $uri;

if (preg_match('#^/(designs|data)(/|$)#i', $uri)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Hozzáférés megtagadva.';
    return true;
}

if ($uri !== '/' && is_file($file)) {
    return false;
}

if ($uri === '/' || $uri === '') {
    require __DIR__ . '/index.html';
    return true;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo 'Nem található.';
return true;
