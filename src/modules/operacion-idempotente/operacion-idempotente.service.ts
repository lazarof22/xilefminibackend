import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types, UpdateQuery } from 'mongoose';
import { esClaveDuplicada } from '../../common/utils/insertar-idempotente';
import {
  EstadoOperacion,
  OperacionIdempotente,
  PasoOperacion,
} from './schema/operacion-idempotente.schema';

/**
 * Quien ejecutaba la operación ya no es su dueño (la recuperación la tomó
 * porque venció el arrendamiento). Hay que parar sin tocar nada más.
 */
export class OperacionPerdidaError extends Error {
  constructor(readonly clave: string) {
    super(
      `La operación ${clave} fue tomada por la recuperación; se detiene esta ejecución`,
    );
    this.name = 'OperacionPerdidaError';
  }
}

export type OperacionLean = OperacionIdempotente & { _id: Types.ObjectId };

/** Lo mínimo para escribir en el registro de una operación que es nuestra. */
export interface ManejadorOperacion {
  id: Types.ObjectId;
  clave: string;
  propietario: string;
  intento: number;
}

export type ResultadoInicio =
  /** Esta ejecución es la dueña: debe hacer el trabajo. */
  | { tipo: 'nueva'; operacion: OperacionLean }
  /** Ya existía (completada, en proceso, en revisión...): mirar su estado. */
  | { tipo: 'existente'; operacion: OperacionLean };

const aPlano = <T>(doc: unknown): T => {
  const conversor = (doc as { toObject?: () => T }).toObject;
  return typeof conversor === 'function'
    ? (conversor.call(doc) as T)
    : (doc as T);
};

const dormir = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

@Injectable()
export class OperacionIdempotenteService {
  private readonly logger = new Logger(OperacionIdempotenteService.name);

  /** Cuánto tiempo es "suya" una operación sin dar señales antes de que la recuperación pueda tomarla. */
  arriendoMs = 30_000;
  /** Cuánto espera un reintento a que termine la ejecución original. */
  esperaMaxMs = 8_000;
  /** Cada cuánto mira si ya terminó mientras espera. */
  intervaloMs = 120;

  constructor(
    @InjectModel(OperacionIdempotente.name)
    private readonly model: Model<OperacionIdempotente>,
  ) {}

  manejador(operacion: OperacionLean): ManejadorOperacion {
    return {
      id: operacion._id,
      clave: operacion.clave,
      propietario: operacion.propietario,
      intento: operacion.intentos,
    };
  }

  private vencimiento(): Date {
    return new Date(Date.now() + this.arriendoMs);
  }

  private asiento(
    op: ManejadorOperacion,
    paso: string,
    evento: string,
    extra: { linea?: number; datos?: Record<string, unknown> } = {},
  ): PasoOperacion {
    return {
      intento: op.intento,
      paso,
      evento,
      ...(extra.linea !== undefined ? { linea: extra.linea } : {}),
      ...(extra.datos ? { datos: extra.datos } : {}),
      fecha: new Date(),
    };
  }

  /**
   * Registra la operación o, si la clave ya existe, decide qué hacer:
   *  - otro usuario, otro tipo de operación u otro cuerpo → 422;
   *  - falló y quedó todo deshecho → se reclama para ejecutarla de nuevo;
   *  - cualquier otro estado → se devuelve tal cual (`existente`).
   * La inserción contra el índice único es lo que desempata a dos
   * peticiones simultáneas con la misma clave: solo una la crea.
   */
  async iniciar(datos: {
    clave: string;
    ambito: string;
    huella: string;
    usuarioId: string;
  }): Promise<ResultadoInicio> {
    const propietario = randomUUID();

    try {
      const creada = await this.model.create({
        ...datos,
        estado: EstadoOperacion.EN_PROCESO,
        propietario,
        vence: this.vencimiento(),
        intentos: 1,
        recuperaciones: 0,
        confirmando: false,
        pasos: [],
      });
      return { tipo: 'nueva', operacion: aPlano<OperacionLean>(creada) };
    } catch (error) {
      if (!esClaveDuplicada(error)) throw error;
    }

    const existente = (await this.model
      .findOne({ clave: datos.clave })
      .lean()
      .exec()) as OperacionLean | null;

    if (!existente) {
      // Solo si alguien la borró a mano entre las dos consultas.
      return this.iniciar(datos);
    }

    if (
      existente.ambito !== datos.ambito ||
      existente.usuarioId !== datos.usuarioId ||
      existente.huella !== datos.huella
    ) {
      throw new UnprocessableEntityException(
        'La clave de idempotencia ya se usó con otros datos. Genere una clave nueva para una operación nueva.',
      );
    }

    if (existente.estado !== EstadoOperacion.FALLIDA) {
      return { tipo: 'existente', operacion: existente };
    }

    // Falló y se deshizo todo: se vuelve a ejecutar con la misma clave. El
    // `findOneAndUpdate` condicional hace que solo uno de varios reintentos
    // simultáneos la reclame.
    const intento = existente.intentos + 1;
    const reclamada = (await this.model
      .findOneAndUpdate(
        {
          _id: existente._id,
          estado: EstadoOperacion.FALLIDA,
          huella: datos.huella,
        },
        {
          $set: {
            estado: EstadoOperacion.EN_PROCESO,
            propietario,
            vence: this.vencimiento(),
            confirmando: false,
            intentos: intento,
          },
          $unset: {
            plan: 1,
            error: 1,
            codigoHttp: 1,
            finalizadaEn: 1,
            respuesta: 1,
          },
          $push: {
            pasos: this.asiento(
              {
                id: existente._id,
                clave: datos.clave,
                propietario,
                intento,
              },
              'operacion',
              'reintento',
            ),
          },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec()) as OperacionLean | null;

    if (reclamada) return { tipo: 'nueva', operacion: reclamada };

    const actual = (await this.model
      .findOne({ clave: datos.clave })
      .lean()
      .exec()) as OperacionLean;
    return { tipo: 'existente', operacion: actual };
  }

  /** Espera (sin bloquear) a que una operación en proceso deje de estarlo. */
  async esperarFin(
    clave: string,
    maxMs: number = this.esperaMaxMs,
  ): Promise<OperacionLean | null> {
    const limite = Date.now() + maxMs;

    for (;;) {
      const operacion = (await this.model
        .findOne({ clave })
        .lean()
        .exec()) as OperacionLean | null;

      if (!operacion || operacion.estado !== EstadoOperacion.EN_PROCESO) {
        return operacion;
      }

      if (Date.now() >= limite) return operacion;

      await dormir(this.intervaloMs);
    }
  }

  leer(clave: string): Promise<OperacionLean | null> {
    return this.model.findOne({ clave }).lean().exec();
  }

  /**
   * Toda escritura exige seguir siendo el dueño y que la operación siga en
   * proceso, y renueva el arrendamiento: mientras la ejecución avance, la
   * recuperación no la toca; solo vence si el proceso se queda parado.
   */
  private async escribir(
    op: ManejadorOperacion,
    update: UpdateQuery<OperacionIdempotente>,
  ): Promise<void> {
    const resultado = await this.model
      .updateOne(
        {
          _id: op.id,
          propietario: op.propietario,
          estado: EstadoOperacion.EN_PROCESO,
        },
        {
          ...update,
          $set: { ...(update.$set ?? {}), vence: this.vencimiento() },
        },
      )
      .exec();

    if (resultado.matchedCount === 0) {
      throw new OperacionPerdidaError(op.clave);
    }
  }

  /** Guarda el plan completo (lo que se va a hacer) antes de tocar nada. */
  registrarPlan(
    op: ManejadorOperacion,
    plan: Record<string, unknown>,
  ): Promise<void> {
    return this.escribir(op, {
      $set: { plan },
      $push: { pasos: this.asiento(op, 'plan', 'registrado') },
    });
  }

  /** Añade un asiento al registro de pasos (siempre ANTES o DESPUÉS de una escritura real). */
  registrarPaso(
    op: ManejadorOperacion,
    paso: string,
    evento: string,
    extra?: { linea?: number; datos?: Record<string, unknown> },
  ): Promise<void> {
    return this.escribir(op, {
      $push: { pasos: this.asiento(op, paso, evento, extra) },
    });
  }

  /**
   * Punto de no retorno: guarda la respuesta final y marca que, desde aquí,
   * ante una caída la operación se COMPLETA (no se revierte).
   */
  marcarConfirmando(
    op: ManejadorOperacion,
    respuesta: Record<string, unknown>,
  ): Promise<void> {
    return this.escribir(op, {
      $set: { confirmando: true, respuesta },
      $push: { pasos: this.asiento(op, 'confirmacion', 'iniciada') },
    });
  }

  completar(
    op: ManejadorOperacion,
    respuesta: Record<string, unknown>,
    codigoHttp = 201,
  ): Promise<void> {
    return this.escribir(op, {
      $set: {
        estado: EstadoOperacion.COMPLETADA,
        respuesta,
        codigoHttp,
        finalizadaEn: new Date(),
      },
      $push: { pasos: this.asiento(op, 'operacion', 'completada') },
    });
  }

  /** Falló y quedó todo deshecho: un reintento con la misma clave podrá ejecutarla otra vez. */
  fallar(
    op: ManejadorOperacion,
    codigoHttp: number,
    cuerpo: unknown,
  ): Promise<void> {
    return this.escribir(op, {
      $set: {
        estado: EstadoOperacion.FALLIDA,
        codigoHttp,
        error: { codigoHttp, cuerpo },
        finalizadaEn: new Date(),
      },
      $push: {
        pasos: this.asiento(op, 'operacion', 'fallida', {
          datos: { codigoHttp, cuerpo },
        }),
      },
    });
  }

  /** Algo quedó dudoso: no se reintenta sola, la revisa una persona. */
  async enviarARevision(op: ManejadorOperacion, motivo: string): Promise<void> {
    this.logger.error(
      `Operación ${op.clave} en REVISIÓN (colección operaciones_idempotentes): ${motivo}`,
    );
    await this.escribir(op, {
      $set: {
        estado: EstadoOperacion.REVISION,
        motivoRevision: motivo,
        finalizadaEn: new Date(),
      },
      $push: {
        pasos: this.asiento(op, 'operacion', 'revision', {
          datos: { motivo },
        }),
      },
    });
  }

  /**
   * Para la recuperación: toma (de una en una, con una actualización
   * condicional) las operaciones de un tipo que siguen en proceso y cuyo
   * arrendamiento ya venció, o sea, las de un proceso que se cayó.
   */
  async reclamarVencidas(
    ambito: string,
    maximo = 20,
  ): Promise<OperacionLean[]> {
    const tomadas: OperacionLean[] = [];

    for (let i = 0; i < maximo; i++) {
      const propietario = randomUUID();
      const operacion = (await this.model
        .findOneAndUpdate(
          {
            ambito,
            estado: EstadoOperacion.EN_PROCESO,
            vence: { $lt: new Date() },
          },
          {
            $set: { propietario, vence: this.vencimiento() },
            $inc: { recuperaciones: 1 },
          },
          { returnDocument: 'after' },
        )
        .lean()
        .exec()) as OperacionLean | null;

      if (!operacion) break;

      tomadas.push(operacion);
    }

    return tomadas;
  }
}
