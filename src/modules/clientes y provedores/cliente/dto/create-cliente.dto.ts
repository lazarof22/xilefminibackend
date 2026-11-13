import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  PATRON_CODIGO_PAIS,
  TIPOS_IDENTIDAD,
  type TipoIdentidad,
} from '../../../../common/utils/identidad';
import { TipoCliente } from '../schemas/cliente.schema';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateClienteDto {
    /**
     * Con qué se identifica: CI (persona natural) o NIT (empresa o mipyme).
     * Sin indicarlo es CI.
     */
    @IsOptional()
    @IsIn(TIPOS_IDENTIDAD)
    tipoIdentidad?: TipoIdentidad;

    /**
     * La CI (11 dígitos) si el cliente se identifica con CI. En un cliente con
     * NIT puede omitirse: se usa el NIT. El formato lo comprueba el servicio.
     */
    @IsOptional()
    @Transform(recortar)
    @IsString()
    @MaxLength(25)
    id_cliente?: string;

    /** El NIT, si el cliente se identifica con NIT. */
    @IsOptional()
    @Transform(recortar)
    @IsString()
    @MaxLength(25)
    nit?: string;

    @IsString()
    @IsNotEmpty()
    nombre_cliente!: string;

    @IsString()
    @IsNotEmpty()
    telefono_cliente!: string;

    /** Prefijo de país del teléfono: +53, +1... Sin indicarlo, +53. */
    @IsOptional()
    @Transform(recortar)
    @IsString()
    @Matches(PATRON_CODIGO_PAIS, {
        message: 'El prefijo de país debe ser un + seguido de 1 a 4 dígitos (+53, +1...)',
    })
    codigoPais?: string;

    @IsString()
    @IsNotEmpty()
    @IsEmail()
    email_cliente!: string;

    @IsString()
    @IsNotEmpty()
    direccion_cliente!: string;

    /** Condición comercial: estándar, con descuento o cuenta casa. */
    @IsIn(Object.values(TipoCliente), {
        message: `tipo_cliente debe ser uno de: ${Object.values(TipoCliente).join(', ')}`,
    })
    tipo_cliente!: TipoCliente;
}
