/**
 * Bancos con los que se llena el nomenclador la primera vez (solo si la
 * colección está vacía): los mismos que ya ofrecía el diálogo de transferencia.
 * Sin prefijos de tarjeta: no hay una fuente oficial que los respalde, así que
 * los configura el administrador en `/banco`.
 */
export const BANCOS_INICIALES: { codigo: string; nombre: string }[] = [
  { codigo: 'BPA', nombre: 'Banco Popular de Ahorro' },
  { codigo: 'BANDEC', nombre: 'Banco de Crédito y Comercio' },
  { codigo: 'BM', nombre: 'Banco Metropolitano' },
  { codigo: 'BICSA', nombre: 'Banco Internacional de Comercio' },
];
