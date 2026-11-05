// Clave de pruebas: la aplicación no arranca sin JWT_SECRET propio.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas-unitarias';
