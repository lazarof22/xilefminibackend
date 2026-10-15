import { Module } from '@nestjs/common';
import { CuadreCajaService } from './cuadre_caja.service';
import { CuadreCajaController } from './cuadre_caja.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { CuadreCaja, CuadreCajaSchema } from './schema/cuadre_caja.schema';
import { Usuarios, UsuariosSchema } from '../../auth/schemas/usuarios.schema';
import { Venta, VentaSchema } from '../venta/schema/venta.schema';
import { Pago, PagoSchema } from '../pago/schema/pago.schema';
import {
  Extraccion,
  ExtraccionSchema,
} from '../extraccion/schema/extraccion.schema';

@Module({
  controllers: [CuadreCajaController],
  providers: [CuadreCajaService],
  imports: [
    MongooseModule.forFeature([
      { name: CuadreCaja.name, schema: CuadreCajaSchema },
      { name: Usuarios.name, schema: UsuariosSchema },
      { name: Venta.name, schema: VentaSchema },
      { name: Pago.name, schema: PagoSchema },
      { name: Extraccion.name, schema: ExtraccionSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class CuadreCajaModule {}
