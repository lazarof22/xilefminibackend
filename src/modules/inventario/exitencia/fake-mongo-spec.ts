/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * Modelo de Mongoose en memoria, SOLO para las pruebas de la Fase 1
 * (`existencia.service.spec.ts`, `conciliacion.service.spec.ts`).
 *
 * Imita lo justo de la API que usan `ExistenciaService` y
 * `ConciliacionService`: find / findOne / findById / exists / updateOne /
 * findOneAndUpdate / findOneAndDelete / aggregate / create, con select, sort,
 * lean y exec, y los operadores `$inc`, `$set`, `$setOnInsert` en los updates y
 * `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in` en los filtros. Con
 * `new FakeModel(docs, { unico: [...] })` imita un índice único (E11000).
 *
 * Cada escritura se aplica de golpe (como MongoDB sobre un documento), pero
 * entre la lectura y la escritura del servicio hay `await`s, así que dos
 * llamadas simultáneas se entrelazan igual que dos cajeros reales. Para
 * forzar un entrelazado concreto, `hooks.antesDeEscribir` se ejecuta justo
 * antes de cada escritura y puede tocar los datos como lo haría otro cajero.
 *
 * Fase 2 (checkout) lo amplía sin cambiar lo anterior: operadores `$push` y
 * `$unset`, `insertMany` (con `ordered: false`), `_id` único en toda inserción
 * (E11000), los ganchos `hooks.antes` / `hooks.despues` sobre CUALQUIER
 * escritura y el `interruptor` que simula la caída del proceso: con
 * `interruptor.caido = true`, toda operación posterior lanza, como si el
 * servidor ya no existiera (la escritura que justo se acaba de aplicar sí
 * queda hecha, igual que en una caída real).
 *
 * Termina en `-spec.ts` para que `tsconfig.build.json` (que excluye los
 * archivos `*spec.ts`) no lo compile en `dist`, y no en `.spec.ts` para que
 * jest no lo ejecute como si fuera una prueba.
 */
import { Types } from 'mongoose';

export type Doc = Record<string, any>;

const esOperador = (valor: unknown): boolean =>
  typeof valor === 'object' &&
  valor !== null &&
  !(valor instanceof Types.ObjectId) &&
  !(valor instanceof Date) &&
  !Array.isArray(valor) &&
  Object.keys(valor).some((clave) => clave.startsWith('$'));

/**
 * Igualdad como la hace MongoDB. Con `estricto`, un ObjectId NUNCA es igual a
 * su versión en texto: en este proyecto los campos de id de casi todos los
 * esquemas se declaran con `type: Types.ObjectId`, que Mongoose 9 trata como
 * `Mixed`, así que NO convierte el texto a ObjectId al consultar ni al guardar.
 * Sin esto, una prueba pasaría aunque el servicio buscara con un texto y en la
 * base real no encontrara nada. (`_id` sí se convierte siempre, como en Mongoose.)
 */
const igual = (a: unknown, b: unknown, estricto = false): boolean => {
  const aEsId = a instanceof Types.ObjectId;
  const bEsId = b instanceof Types.ObjectId;

  if (aEsId || bEsId) {
    if (estricto && aEsId !== bEsId) return false;
    return String(a) === String(b);
  }

  return a === b;
};

const comparable = (valor: unknown): number | string =>
  valor instanceof Types.ObjectId ? String(valor) : (valor as number | string);

function coincide(doc: Doc, filtro: Doc): boolean {
  return Object.entries(filtro).every(([campo, esperado]) => {
    const valor = doc[campo];
    const estricto = campo !== '_id';

    if (!esOperador(esperado)) {
      return igual(valor, esperado, estricto);
    }

    return Object.entries(esperado as Doc).every(([operador, v]) => {
      switch (operador) {
        case '$gt':
          return valor > v;
        case '$gte':
          return valor >= v;
        case '$lt':
          return valor < v;
        case '$lte':
          return valor <= v;
        case '$ne':
          return !igual(valor, v, estricto);
        case '$in':
          return (v as unknown[]).some((x) => igual(valor, x, estricto));
        default:
          throw new Error(`Operador de filtro no soportado: ${operador}`);
      }
    });
  });
}

function aplicar(doc: Doc, update: Doc): void {
  for (const [operador, campos] of Object.entries(update)) {
    for (const [campo, v] of Object.entries(campos as Doc)) {
      if (operador === '$inc') {
        doc[campo] = (doc[campo] ?? 0) + (v as number);
      } else if (operador === '$set') {
        doc[campo] = v;
      } else if (operador === '$push') {
        // Siempre un arreglo nuevo: las copias leídas antes no cambian.
        doc[campo] = [...((doc[campo] as unknown[] | undefined) ?? []), v];
      } else if (operador === '$unset') {
        delete doc[campo];
      } else if (operador !== '$setOnInsert') {
        throw new Error(`Operador de update no soportado: ${operador}`);
      }
    }
  }
}

/** Consulta encadenable (select/sort/lean) que se resuelve con `await` o `.exec()`. */
class Consulta<T> implements PromiseLike<T> {
  private campos?: string[];
  orden?: Record<string, 1 | -1>;

  constructor(private readonly ejecutar: (consulta: Consulta<T>) => unknown) {}

  select(campos: string): this {
    this.campos = campos.split(/\s+/).filter(Boolean);
    return this;
  }

  sort(orden: Record<string, 1 | -1>): this {
    this.orden = orden;
    return this;
  }

  lean(): this {
    return this;
  }

  session(): this {
    return this;
  }

  exec(): Promise<T> {
    return new Promise<T>((resolver, rechazar) => {
      // La escritura ocurre al ejecutar, no al construir la consulta.
      Promise.resolve()
        .then(() => resolver(this.resolver()))
        .catch(rechazar);
    });
  }

  then<R1 = T, R2 = never>(
    ok?: ((valor: T) => R1 | PromiseLike<R1>) | null,
    error?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.exec().then(ok, error);
  }

  private proyectar(doc: Doc | null): Doc | null {
    if (!doc) return doc;
    if (!this.campos) return { ...doc };
    const salida: Doc = { _id: doc._id };
    for (const campo of this.campos) salida[campo] = doc[campo];
    return salida;
  }

  private resolver(): T {
    const resultado = this.ejecutar(this) as Doc | Doc[] | null;

    if (Array.isArray(resultado)) {
      const lista = [...resultado];

      if (this.orden) {
        const [campo, direccion] = Object.entries(this.orden)[0];
        lista.sort((a, b) => {
          const va = comparable(a[campo]);
          const vb = comparable(b[campo]);
          return va === vb ? 0 : (va > vb ? 1 : -1) * direccion;
        });
      }

      return lista.map((doc) => this.proyectar(doc)) as unknown as T;
    }

    return this.proyectar(resultado) as unknown as T;
  }
}

export interface OpcionesHooks {
  /**
   * Se llama justo antes de cada updateOne / findOneAndUpdate (n = número de
   * escritura de ese modelo, desde 1). Sirve para simular a otro cajero.
   */
  antesDeEscribir?: (n: number, filtro: Doc, update: Doc) => void;
  /**
   * Fase 2. Se llama justo ANTES de cualquier escritura (`updateOne`,
   * `findOneAndUpdate`, `findOneAndDelete`, `create`, `insertMany`). `datos`
   * trae `{ filtro, update }` o `{ docs }`. Puede dejar caído el interruptor.
   */
  antes?: (op: string, datos: Doc) => void;
  /**
   * Fase 2. Se llama justo DESPUÉS de aplicar la escritura y antes de que el
   * llamador reciba la respuesta: si aquí se deja caído el interruptor, la
   * escritura queda hecha pero el llamador ve un error (caída a mitad).
   */
  despues?: (op: string, datos: Doc) => void;
}

/** Simula que el proceso del servidor murió: con `caido = true` todo lanza. */
export interface Interruptor {
  caido: boolean;
}

export interface OpcionesFake {
  /**
   * Campos de un índice único (como `producto + almacén + contenedor` en
   * `existencias`). Comparan el valor Y su tipo, como MongoDB: un id guardado
   * como texto y el mismo id como ObjectId son valores distintos y conviven.
   * Insertar o actualizar hasta repetir la clave lanza E11000.
   */
  unico?: string[];
  /** Compartido entre los modelos de un mismo "proceso" para simular su caída. */
  interruptor?: Interruptor;
}

/** Clave de comparación de un `_id` que distingue ObjectId de texto, como MongoDB. */
const claveId = (valor: unknown): string =>
  `${valor instanceof Types.ObjectId ? 'id' : typeof valor}:${String(valor)}`;

export class FakeModel {
  docs: Doc[];
  escrituras = 0;
  hooks: OpcionesHooks = {};
  /** Si devuelve un error, la escritura lanza ese error (red caída, timeout). */
  fallarSi?: (filtro: Doc, update: Doc) => Error | undefined;
  private readonly unico?: string[];
  private readonly interruptor?: Interruptor;

  constructor(inicial: Doc[] = [], opciones: OpcionesFake = {}) {
    this.unico = opciones.unico;
    this.interruptor = opciones.interruptor;
    this.docs = [];
    inicial.forEach((doc) => this.insertar(doc));
  }

  /** Inserta directamente (preparación de la prueba); devuelve el documento guardado. */
  insertar(doc: Doc): Doc {
    const nuevo = { _id: new Types.ObjectId(), ...doc };

    if (this.docs.some((d) => claveId(d._id) === claveId(nuevo._id))) {
      throw Object.assign(new Error('E11000 duplicate key error (_id)'), {
        code: 11000,
      });
    }

    this.verificarUnico(nuevo);
    this.docs.push(nuevo);
    return nuevo;
  }

  /** Lanza si el "proceso" está caído (ver `Interruptor`). */
  private vivo(): void {
    if (this.interruptor?.caido) {
      throw new Error('Proceso caído (simulado): no hay conexión con la base');
    }
  }

  private antes(op: string, datos: Doc): void {
    this.vivo();
    this.hooks.antes?.(op, datos);
    this.vivo();
  }

  private despues(op: string, datos: Doc): void {
    this.hooks.despues?.(op, datos);
    this.vivo();
  }

  private claveUnica(doc: Doc): string | undefined {
    if (!this.unico) return undefined;

    return this.unico
      .map((campo) => {
        const valor = doc[campo];
        const tipo = valor instanceof Types.ObjectId ? 'id' : typeof valor;
        return `${tipo}:${String(valor)}`;
      })
      .join('|');
  }

  /** Lanza E11000 si `doc` repetiría la clave de otro documento (que no sea `original`). */
  private verificarUnico(doc: Doc, original?: Doc): void {
    const clave = this.claveUnica(doc);

    if (
      clave !== undefined &&
      this.docs.some((d) => d !== original && this.claveUnica(d) === clave)
    ) {
      throw Object.assign(new Error('E11000 duplicate key error'), {
        code: 11000,
      });
    }
  }

  /** Aplica un update comprobando antes que no rompa el índice único. */
  private actualizar(doc: Doc, update: Doc): void {
    const prueba = { ...doc };
    aplicar(prueba, update);
    this.verificarUnico(prueba, doc);
    aplicar(doc, update);
  }

  porId(id: unknown): Doc | undefined {
    return this.docs.find((d) => igual(d._id, id));
  }

  find(filtro: Doc = {}): Consulta<Doc[]> {
    return new Consulta<Doc[]>(() => {
      this.vivo();
      return this.docs.filter((doc) => coincide(doc, filtro));
    });
  }

  findOne(filtro: Doc = {}): Consulta<Doc | null> {
    return new Consulta<Doc | null>((consulta) => {
      this.vivo();
      let lista = this.docs.filter((doc) => coincide(doc, filtro));

      if (consulta.orden) {
        const [campo, direccion] = Object.entries(consulta.orden)[0];
        lista = [...lista].sort((a, b) => {
          const va = comparable(a[campo]);
          const vb = comparable(b[campo]);
          return va === vb ? 0 : (va > vb ? 1 : -1) * direccion;
        });
      }

      return lista[0] ?? null;
    });
  }

  findById(id: unknown): Consulta<Doc | null> {
    return this.findOne({ _id: id });
  }

  exists(filtro: Doc): Consulta<{ _id: unknown } | null> {
    return new Consulta<{ _id: unknown } | null>(() => {
      this.vivo();
      const doc = this.docs.find((d) => coincide(d, filtro));
      return doc ? { _id: doc._id } : null;
    });
  }

  updateOne(
    filtro: Doc,
    update: Doc,
    opciones: { upsert?: boolean } = {},
  ): Consulta<{ matchedCount: number; modifiedCount: number }> {
    return new Consulta(() => {
      this.antesDeEscribir('updateOne', filtro, update);
      const doc = this.docs.find((d) => coincide(d, filtro));

      if (!doc) {
        if (opciones.upsert) this.insertarPorUpsert(filtro, update);
        this.despues('updateOne', { filtro, update });
        return { matchedCount: 0, modifiedCount: 0 };
      }

      this.actualizar(doc, update);
      this.despues('updateOne', { filtro, update });
      return { matchedCount: 1, modifiedCount: 1 };
    });
  }

  findOneAndUpdate(
    filtro: Doc,
    update: Doc,
    opciones: { upsert?: boolean; new?: boolean; returnDocument?: string } = {},
  ): Consulta<Doc | null> {
    const devolverNuevo =
      opciones.new === true || opciones.returnDocument === 'after';

    return new Consulta<Doc | null>(() => {
      this.antesDeEscribir('findOneAndUpdate', filtro, update);
      const doc = this.docs.find((d) => coincide(d, filtro));

      if (!doc) {
        if (!opciones.upsert) return null;
        const nuevo = this.insertarPorUpsert(filtro, update);
        this.despues('findOneAndUpdate', { filtro, update });
        return devolverNuevo ? { ...nuevo } : null;
      }

      const antes = { ...doc };
      this.actualizar(doc, update);
      this.despues('findOneAndUpdate', { filtro, update });
      return devolverNuevo ? { ...doc } : antes;
    });
  }

  /** Borra el primer documento que cumpla el filtro y lo devuelve (null si no hay). */
  findOneAndDelete(filtro: Doc = {}): Consulta<Doc | null> {
    return new Consulta<Doc | null>(() => {
      this.antes('findOneAndDelete', { filtro });
      const indice = this.docs.findIndex((d) => coincide(d, filtro));

      if (indice === -1) return null;

      const [borrado] = this.docs.splice(indice, 1);
      this.despues('findOneAndDelete', { filtro });
      return borrado;
    });
  }

  /** Como Mongoose: un update sin operadores se aplica como `$set`. */
  findByIdAndUpdate(
    id: unknown,
    update: Doc,
    opciones: { new?: boolean; returnDocument?: string } = {},
  ): Consulta<Doc | null> {
    const conOperador = Object.keys(update).some((k) => k.startsWith('$'));
    return this.findOneAndUpdate(
      { _id: id },
      conOperador ? update : { $set: update },
      opciones,
    );
  }

  /** Solo `[{ $match }, { $group: { _id: null, total: { $sum: '$campo' } } }]`. */
  aggregate<R = Doc>(pipeline: Doc[]): Consulta<R[]> {
    return new Consulta<R[]>(() => {
      this.vivo();
      let filas = [...this.docs];
      let resultado: Doc[] = filas;

      for (const etapa of pipeline) {
        if (etapa.$match) {
          filas = filas.filter((doc) => {
            // Como MongoDB: `aggregate` NO convierte strings a ObjectId.
            for (const [campo, esperado] of Object.entries(
              etapa.$match as Doc,
            )) {
              // Con operador (`$in`...) `coincide` ya compara el tipo de cada valor.
              if (esOperador(esperado)) continue;

              const valor = doc[campo];
              if (
                valor instanceof Types.ObjectId !==
                esperado instanceof Types.ObjectId
              ) {
                return false;
              }
            }
            return coincide(doc, etapa.$match);
          });
          resultado = filas;
        } else if (etapa.$group) {
          const campo = String(etapa.$group.total.$sum).slice(1);
          resultado = filas.length
            ? [
                {
                  _id: null,
                  total: filas.reduce((suma, d) => suma + (d[campo] ?? 0), 0),
                },
              ]
            : [];
        } else {
          throw new Error('Etapa de aggregate no soportada');
        }
      }

      return resultado;
    });
  }

  create(datos: Doc | Doc[]): Promise<any> {
    try {
      const lista = Array.isArray(datos) ? datos : [datos];
      this.antes('create', { docs: lista });
      const creados = lista.map((d) => this.insertar(d));
      this.despues('create', { docs: creados });
      return Promise.resolve(Array.isArray(datos) ? creados : creados[0]);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Como `Model.insertMany`. Con `{ ordered: false }` inserta todo lo que
   * puede y al final lanza un error con `writeErrors` (uno por documento
   * rechazado, cada uno con su `code`), igual que `MongoBulkWriteError`.
   */
  insertMany(
    datos: Doc[],
    opciones: { ordered?: boolean } = {},
  ): Promise<Doc[]> {
    try {
      this.antes('insertMany', { docs: datos });

      const insertados: Doc[] = [];
      const writeErrors: { index: number; code: number }[] = [];

      datos.forEach((doc, index) => {
        try {
          insertados.push(this.insertar(doc));
        } catch (error) {
          writeErrors.push({
            index,
            code: Number((error as { code?: unknown }).code ?? 0),
          });
          if (opciones.ordered !== false) throw error;
        }
      });

      if (writeErrors.length > 0) {
        throw Object.assign(
          new Error('E11000 duplicate key error (insertMany)'),
          {
            code: writeErrors[0].code,
            writeErrors,
          },
        );
      }

      this.despues('insertMany', { docs: insertados });
      return Promise.resolve(insertados);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private antesDeEscribir(op: string, filtro: Doc, update: Doc): void {
    this.vivo();
    this.escrituras += 1;
    this.hooks.antesDeEscribir?.(this.escrituras, filtro, update);
    this.hooks.antes?.(op, { filtro, update });
    this.vivo();
    const error = this.fallarSi?.(filtro, update);
    if (error) throw error;
  }

  private insertarPorUpsert(filtro: Doc, update: Doc): Doc {
    const base: Doc = {};

    for (const [campo, valor] of Object.entries(filtro)) {
      if (!esOperador(valor)) base[campo] = valor;
    }

    // Se arma el documento completo ANTES de insertarlo, para que el índice
    // único (si lo hay) vea la clave definitiva.
    const nuevo: Doc = { _id: new Types.ObjectId(), ...base };
    Object.assign(nuevo, (update.$setOnInsert as Doc) ?? {});
    aplicar(nuevo, update);
    this.verificarUnico(nuevo);
    this.docs.push(nuevo);
    return nuevo;
  }
}
