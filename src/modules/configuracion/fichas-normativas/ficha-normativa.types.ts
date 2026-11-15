/** Numbering rule of a document type, as implemented by its module. */
export interface NumeracionFicha {
  /** Prefix passed to `ConsecutivoService.siguiente`; `null` when the document has no own sequence. */
  prefijo: string | null;
  /** Human-readable description of the numbering rule. */
  formato: string;
  /** Sample number; `null` when the document has no own sequence. */
  ejemplo: string | null;
}

/** Normative sheet (ficha normativa) of one document type produced by the system. */
export interface FichaNormativa {
  /** Official form code, e.g. `SC-2-04`. Used as the lookup key. */
  codigo: string;
  nombre: string;
  /** Norm name as already used in the module README/schema comments. */
  norma: string;
  /** Required request fields, taken from the module's `create-*.dto.ts`. */
  camposObligatorios: string[];
  numeracion: NumeracionFicha;
  /** Fields that carry the signature / responsible persons of the document. */
  firmas: string[];
  /** Source module of the document (repository-relative path). */
  moduloApi: string;
}
