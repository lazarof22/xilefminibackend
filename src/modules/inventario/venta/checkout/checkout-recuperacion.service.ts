import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ManejadorOperacion,
  OperacionIdempotenteService,
  OperacionLean,
  OperacionPerdidaError,
} from '../../../operacion-idempotente/operacion-idempotente.service';
import { CheckoutService } from './checkout.service';
import {
  AMBITO_CHECKOUT,
  cuerpoError,
  estadoDeStock,
  leerPlan,
  PlanCheckout,
  RespuestaCheckout,
  ResultadoLinea,
} from './checkout.types';

/** Cada cuánto se buscan ventas que se quedaron a medias. */
export const INTERVALO_RECUPERACION_MS = 15_000;

export type ResultadoRecuperacion =
  /** Había pasado el punto de no retorno: se terminó de registrar la venta. */
  | 'completada'
  /** No había llegado a confirmarse: se devolvió el stock y se marcó como fallida (reintentable). */
  | 'revertida'
  /** Se cayó antes de guardar el plan: no había tocado nada. */
  | 'sin_plan'
  /** Algo es dudoso: la revisa una persona (estado `revision`). */
  | 'revision'
  /** No se pudo terminar ahora; se vuelve a intentar más tarde. */
  | 'pendiente';

export interface InformeRecuperacion {
  clave: string;
  resultado: ResultadoRecuperacion;
}

/**
 * Termina o deshace los checkouts que un proceso dejó a medias al caerse.
 *
 * Una operación "en proceso" cuyo arrendamiento venció (nadie la ha tocado en
 * el tiempo que dura el arrendamiento) es de un proceso caído. Según lo que
 * quedó anotado en su registro de pasos:
 *
 *  - antes del punto de no retorno → se devuelve el stock reservado y la
 *    operación queda `fallida`; el cliente puede reintentar con la misma clave;
 *  - desde el punto de no retorno → se termina de registrar pago, venta,
 *    Kardex y Reporte Plus (los pasos son repetibles) y queda `completada`;
 *  - si algo es dudoso (no se sabe si un descuento se aplicó, o una devolución
 *    falla) → `revision`, sin tocar el stock a ciegas.
 */
@Injectable()
export class CheckoutRecuperacionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CheckoutRecuperacionService.name);
  private barriendo = false;

  /** Veces que se intenta terminar una operación antes de pasarla a revisión. */
  maximoRecuperaciones = 5;

  constructor(
    private readonly idem: OperacionIdempotenteService,
    private readonly checkout: CheckoutService,
  ) {}

  onApplicationBootstrap(): void {
    // Sin esperar: no debe retrasar el arranque del servidor.
    void this.barrer();
  }

  @Interval(INTERVALO_RECUPERACION_MS)
  async barrer(): Promise<InformeRecuperacion[]> {
    if (this.barriendo) return [];
    this.barriendo = true;

    const informes: InformeRecuperacion[] = [];
    try {
      const vencidas = await this.idem.reclamarVencidas(AMBITO_CHECKOUT);

      for (const operacion of vencidas) {
        try {
          informes.push({
            clave: operacion.clave,
            resultado: await this.recuperar(operacion),
          });
        } catch (error) {
          // Se queda en proceso: vuelve a vencer y se reintenta en otro barrido.
          this.logger.error(
            `Recuperación del checkout ${operacion.clave} fallida (se reintentará): ${String(error)}`,
          );
          informes.push({ clave: operacion.clave, resultado: 'pendiente' });
        }
      }

      if (informes.length > 0) {
        this.logger.warn(
          `Recuperación de checkouts: ${informes.map((i) => `${i.clave}=${i.resultado}`).join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.error(`Barrido de recuperación fallido: ${String(error)}`);
    } finally {
      this.barriendo = false;
    }

    return informes;
  }

  /** Recupera UNA operación ya reclamada (con arrendamiento nuevo). */
  async recuperar(operacion: OperacionLean): Promise<ResultadoRecuperacion> {
    const op = this.idem.manejador(operacion);

    try {
      if (operacion.recuperaciones > this.maximoRecuperaciones) {
        return await this.aRevision(
          op,
          `No se pudo terminar tras ${operacion.recuperaciones - 1} intentos de recuperación`,
        );
      }

      const hayPlan = operacion.plan !== undefined && operacion.plan !== null;
      let plan: PlanCheckout | undefined;
      try {
        plan = leerPlan(operacion.plan);
      } catch {
        plan = undefined;
      }

      if (!hayPlan) {
        // Se cayó antes de guardar el plan: no había tocado nada.
        if (operacion.confirmando) {
          return await this.aRevision(
            op,
            'Operación confirmada sin plan guardado',
          );
        }
        await this.idem.fallar(op, 503, this.cuerpoInterrumpida());
        return 'sin_plan';
      }

      if (!plan) {
        return await this.aRevision(op, 'El plan guardado no se puede leer');
      }

      return operacion.confirmando
        ? await this.terminar(op, operacion, plan)
        : await this.deshacer(op, operacion);
    } catch (error) {
      // La tomó otro (el arrendamiento venció a mitad de la recuperación).
      if (error instanceof OperacionPerdidaError) return 'pendiente';
      throw error;
    }
  }

  /** Roll-forward: completa pago, venta, Kardex y Reporte Plus con lo que quedó anotado. */
  private async terminar(
    op: ManejadorOperacion,
    operacion: OperacionLean,
    plan: PlanCheckout,
  ): Promise<ResultadoRecuperacion> {
    const respuesta = operacion.respuesta as unknown as
      RespuestaCheckout | undefined;

    if (!respuesta?.comprobante) {
      return this.aRevision(op, 'Operación confirmada sin respuesta guardada');
    }

    const estados = estadoDeStock(operacion.pasos, op.intento);
    const resultados = new Map<number, ResultadoLinea>();

    for (const linea of plan.lineas) {
      const estado = estados.get(linea.indice);

      if (estado?.evento !== 'hecho' || !estado.resultado) {
        return this.aRevision(
          op,
          `Operación confirmada pero la línea ${linea.indice + 1} (${linea.nombre}) no figura como descontada`,
        );
      }

      resultados.set(linea.indice, estado.resultado);
    }

    await this.checkout.confirmar(
      op,
      plan,
      respuesta.comprobante,
      resultados,
      respuesta,
    );
    return 'completada';
  }

  /** Roll-back: devuelve el stock reservado y deja la operación reintentable. */
  private async deshacer(
    op: ManejadorOperacion,
    operacion: OperacionLean,
  ): Promise<ResultadoRecuperacion> {
    const reversa = await this.checkout.revertir(op, operacion);

    if (reversa.ambiguas.length > 0 || reversa.fallidas.length > 0) {
      return this.aRevision(
        op,
        `Venta interrumpida por una caída con stock dudoso: ${reversa.detalle.join('; ')}`,
      );
    }

    await this.idem.fallar(op, 503, this.cuerpoInterrumpida());
    return 'revertida';
  }

  private async aRevision(
    op: ManejadorOperacion,
    motivo: string,
  ): Promise<ResultadoRecuperacion> {
    await this.idem.enviarARevision(op, motivo);
    return 'revision';
  }

  private cuerpoInterrumpida() {
    return cuerpoError(
      503,
      'Service Unavailable',
      'La venta se interrumpió por una caída del servidor antes de confirmarse y no se registró nada. Reintente con la misma clave.',
      'VENTA_INTERRUMPIDA',
    );
  }
}
