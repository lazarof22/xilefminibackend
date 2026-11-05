// Aplica el plugin del CLI de Swagger también bajo ts-jest, igual que `nest build`.
// Así `GET /docs-json` falla en la suite e2e si un DTO rompe el plugin (el
// backend llegó a no arrancar por un ciclo en LineaAjusteDto).
const plugin = require('@nestjs/swagger/plugin');

module.exports.name = 'nestjs-swagger-transformer';
module.exports.version = 1;
module.exports.factory = (compiler) => plugin.before({}, compiler.program);
