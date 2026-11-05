# Pruebas e2e

Arrancan el `AppModule` real, con la misma configuración global que
`src/main.ts` (`src/app.setup.ts`), contra una MongoDB real y llaman a la API por
HTTP (supertest, sin abrir el puerto 3000).

```bash
MONGO_TEST_URI=mongodb://127.0.0.1:27017/xilef_e2e npm run test:e2e
```

- Sin `MONGO_TEST_URI` las suites se omiten (salida 0).
- El nombre de la base debe contener `e2e` o `test`; si no, la suite se niega a
  correr. Cada suite usa una base propia `<nombre>_<aleatorio>` que borra al
  terminar; la base con el nombre exacto de la URI no se toca.
- Se necesita MongoDB en marcha. No hace falta licencia ni leer `.env`: la suite
  fija `MONGODB_URI` y `JWT_SECRET` antes de importar `AppModule`.
- `jest-e2e.json` aplica también el plugin de Swagger del CLI (ver
  `helpers/swagger-transformer.js`), de modo que `GET /docs-json` falla si un DTO
  vuelve a romper el documento.
- Los tests marcados `it.failing` documentan defectos reales de producción aún
  sin corregir; cuando se arreglen, el test empezará a fallar y hay que quitar
  `.failing`.
