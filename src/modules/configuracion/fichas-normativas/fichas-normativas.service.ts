import { Injectable, NotFoundException } from '@nestjs/common';
import { FICHAS_NORMATIVAS } from './fichas-normativas.catalogo';
import { FichaNormativa } from './ficha-normativa.types';

/** Read-only access to the static catalog of normative sheets. */
@Injectable()
export class FichasNormativasService {
  listar(): FichaNormativa[] {
    return [...FICHAS_NORMATIVAS];
  }

  /** Lookup is case-insensitive on the form code. */
  obtener(codigo: string): FichaNormativa {
    const buscado = codigo.trim().toUpperCase();
    const ficha = FICHAS_NORMATIVAS.find((f) => f.codigo === buscado);
    if (!ficha) {
      throw new NotFoundException(
        `No existe una ficha normativa con código ${codigo}`,
      );
    }
    return ficha;
  }
}
