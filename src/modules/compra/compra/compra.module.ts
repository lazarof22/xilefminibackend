import { Module } from '@nestjs/common';
import { CompraService } from './compra.service';
import { CompraController } from './compra.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Compra, CompraSchema } from './schema/compra.schema';
import { Producto, ProductoSchema } from '../../inventario/producto/schemas/producto.schema';
import { Kardex, KardexSchema } from '../../inventario/kardex/schema/kardex.schema';
import { CuentaPagar, CuentaPagarSchema } from '../../finanzas/cuenta-pagar/schema/cuenta-pagar.schema';
import { Comprobante, ComprobanteSchema } from '../../contabilidad/comprobante/schema/comprobante.schema';
import { Cuenta, CuentaSchema } from '../../contabilidad/cuenta/schema/cuenta.schema';
import { NomencladorHelperModule } from '../../configuracion/nomenclador-helper/nomenclador-helper.module';

@Module({
  controllers: [CompraController],
  providers: [CompraService],
  imports: [
    MongooseModule.forFeature([
      { name: Compra.name, schema: CompraSchema },
      { name: Producto.name, schema: ProductoSchema },
      { name: Kardex.name, schema: KardexSchema },
      { name: CuentaPagar.name, schema: CuentaPagarSchema },
      { name: Comprobante.name, schema: ComprobanteSchema },
      { name: Cuenta.name, schema: CuentaSchema },
    ]),
    NomencladorHelperModule,
  ],
  exports: [MongooseModule],
})
export class CompraModule {}
