import { IsIn } from 'class-validator';
import {
  TIPOS_TASA,
  type TipoTasa,
} from '../schema/configuracion-pagos.schema';

export class UpdateConfiguracionPagosDto {
  /** `tasaBancoCentral` (oficial) o `tasaMercadoInformal`. */
  @IsIn(TIPOS_TASA)
  tipoTasa!: TipoTasa;
}
