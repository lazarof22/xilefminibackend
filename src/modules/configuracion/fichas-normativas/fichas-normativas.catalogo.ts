import { FichaNormativa } from './ficha-normativa.types';

/**
 * Static catalog of normative sheets. Every value is derived from the module
 * that produces the document:
 * - `numeracion.prefijo`: argument of `ConsecutivoService.siguiente(clave, prefijo)`
 *   in each module's service (the sequence is `PREFIJO-` + 6 zero-padded digits).
 * - `camposObligatorios`: required properties of the module's `create-*.dto.ts`.
 * - `firmas`: signature/responsible fields of the DTO and schema.
 * - `norma`: only the name already used in the module README/schema comments.
 */
export const FICHAS_NORMATIVAS: readonly FichaNormativa[] = Object.freeze([
  {
    codigo: 'SC-2-04',
    nombre: 'Informe de Recepción',
    norma: 'SC-2-04',
    camposObligatorios: [
      'almacenReceptor',
      'proveedor',
      'documentoOrigen.tipo',
      'documentoOrigen.numero',
      'documentoOrigen.fecha',
      'responsableComprobacion',
      'lineas (al menos una)',
      'lineas[].producto',
      'lineas[].contenedor',
      'lineas[].cantidad',
      'lineas[].costo_unitario',
    ],
    numeracion: {
      prefijo: 'REC',
      formato: 'REC-NNNNNN (consecutivo "recepcion", 6 dígitos)',
      ejemplo: 'REC-000001',
    },
    firmas: ['responsableComprobacion'],
    moduloApi: 'src/modules/inventario/recepcion',
  },
  {
    codigo: 'SC-2-08',
    nombre: 'Vale de Entrega o Devolución',
    norma: 'SC-2-08',
    camposObligatorios: [
      'tipo',
      'origenTipo',
      'origenRef',
      'motivo',
      'lineas (al menos una)',
      'lineas[].producto',
      'lineas[].cantidadSolicitada',
      'lineas[].cantidadEntregada',
      'autorizadoPor',
      'recibidoPor',
      'firma',
    ],
    numeracion: {
      prefijo: 'DEV',
      formato: 'DEV-NNNNNN (consecutivo "devolucion", 6 dígitos)',
      ejemplo: 'DEV-000001',
    },
    firmas: ['autorizadoPor', 'recibidoPor', 'firma'],
    moduloApi: 'src/modules/inventario/devolucion',
  },
  {
    codigo: 'SC-2-09',
    nombre: 'Transferencia entre almacenes',
    norma: 'SC-2-09',
    camposObligatorios: [
      'almacen_origen',
      'almacen_destino',
      'contenedor_origen',
      'contenedor_destino',
      'producto',
      'cantidad',
      'autorizadoPor',
      'entregadoPor',
      'recibidoPor',
    ],
    numeracion: {
      prefijo: 'TRF',
      formato: 'TRF-NNNNNN (consecutivo "transferencia", 6 dígitos)',
      ejemplo: 'TRF-000001',
    },
    firmas: ['autorizadoPor', 'entregadoPor', 'recibidoPor'],
    moduloApi: 'src/modules/inventario/transferencia',
  },
  {
    codigo: 'SC-2-16',
    nombre: 'Ajuste de Inventario',
    norma: 'SC-2-16',
    camposObligatorios: [
      'causa',
      'autorizadoPor',
      'firmadoPor',
      'lineas (al menos una)',
      'lineas[].producto',
      'lineas[].almacen',
      'lineas[].contenedor',
      'lineas[].ajuste',
    ],
    numeracion: {
      prefijo: 'AJU',
      formato: 'AJU-NNNNNN (consecutivo "ajuste", 6 dígitos)',
      ejemplo: 'AJU-000001',
    },
    firmas: ['autorizadoPor', 'firmadoPor'],
    moduloApi: 'src/modules/inventario/ajuste-inventario',
  },
  {
    codigo: 'SC-3-06',
    nombre: 'Arqueo de Caja',
    norma: 'Resolución 12/2007',
    camposObligatorios: [
      'turnoCajaId',
      'responsableArqueo',
      'responsableCustodia',
      'efectivoContado',
      'observaciones',
      'firmadoPor',
    ],
    numeracion: {
      prefijo: null,
      formato:
        'Sin consecutivo propio: un solo arqueo por turno de caja (se identifica por turnoCajaId)',
      ejemplo: null,
    },
    firmas: ['responsableArqueo', 'responsableCustodia', 'firmadoPor'],
    moduloApi: 'src/modules/inventario/arqueo-caja',
  },
  {
    codigo: 'SC-2-13',
    nombre: 'Submayor / Kardex',
    norma: 'SC-2-13',
    camposObligatorios: ['productoId', 'tipo', 'cantidad', 'motivo'],
    numeracion: {
      prefijo: null,
      formato:
        'Sin consecutivo propio: referencia y referenciaContable son texto libre opcional',
      ejemplo: null,
    },
    // The kardex DTO carries no signature field; the sheet says so explicitly.
    firmas: [],
    moduloApi: 'src/modules/inventario/kardex',
  },
]);
