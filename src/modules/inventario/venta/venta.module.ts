import { Module } from '@nestjs/common';
import { VentaService } from './venta.service';
import { VentaController } from './venta.controller';
import { Venta, VentaSchema } from './schema/venta.schema';
import {
  Cliente,
  ClienteSchema,
} from 'src/modules/clientes y provedores/cliente/schemas/cliente.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { Producto, ProductoSchema } from '../producto/schemas/producto.schema';
import {
  Kardex,
  KardexSchema,
} from 'src/modules/inventario/kardex/schema/kardex.schema';
import { Pago, PagoSchema } from '../pago/schema/pago.schema';
import { ReportePlusModule } from '../reporte_plus/reporte_plus.module';
import { ExistenciaModule } from '../exitencia/existencia.module';
import { PagoModule } from '../pago/pago.module';
import { ConfiguracionTributariaModule } from '../../configuracion-tributaria/configuracion-tributaria.module';
import { OperacionIdempotenteModule } from '../../operacion-idempotente/operacion-idempotente.module';
import {
  VentaContador,
  VentaContadorSchema,
} from './schema/venta-contador.schema';
import { CheckoutService } from './checkout/checkout.service';
import { CheckoutRecuperacionService } from './checkout/checkout-recuperacion.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Venta.name, schema: VentaSchema },
      { name: Cliente.name, schema: ClienteSchema },
      { name: Producto.name, schema: ProductoSchema },
      { name: Kardex.name, schema: KardexSchema },
      { name: Pago.name, schema: PagoSchema },
      { name: VentaContador.name, schema: VentaContadorSchema },
    ]),
    ReportePlusModule,
    ExistenciaModule,
    PagoModule,
    ConfiguracionTributariaModule,
    OperacionIdempotenteModule,
  ],
  controllers: [VentaController],
  providers: [VentaService, CheckoutService, CheckoutRecuperacionService],
})
export class VentaModule {}
