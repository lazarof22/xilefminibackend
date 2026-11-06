import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConsecutivoModule } from '../consecutivo/consecutivo.module';
import { ExistenciaModule } from '../exitencia/existencia.module';
import { Almacen, AlmacenSchema } from '../almacen/schema/almacen.schema';
import {
  Contenedor,
  ContenedorSchema,
} from '../contenedor/schema/contenedor.schema';
import { Kardex, KardexSchema } from '../kardex/schema/kardex.schema';
import { Producto, ProductoSchema } from '../producto/schemas/producto.schema';
import {
  TurnoCaja,
  TurnoCajaSchema,
} from '../turno-caja/schema/turno-caja.schema';
import { Venta, VentaSchema } from '../venta/schema/venta.schema';
import { Pago, PagoSchema } from '../pago/schema/pago.schema';
import {
  RegistroCompra,
  RegistroCompraSchema,
} from '../registro-compra/schema/registro-compra.schema';
import { Factura, FacturaSchema } from '../../factura/schema/factura.schema';
import { DevolucionController } from './devolucion.controller';
import { DevolucionService } from './devolucion.service';
import { DevolucionOrigenService } from './devolucion-origen.service';
import { DevolucionRecuperacionCron } from './devolucion-recuperacion.cron';
import { Devolucion, DevolucionSchema } from './schema/devolucion.schema';
import {
  DevolucionAcumulado,
  DevolucionAcumuladoSchema,
} from './schema/devolucion-acumulado.schema';

/**
 * Vale de Entrega o Devolución SC-2-08. Venta, Pago, Factura y RegistroCompra
 * se registran SOLO para leer el origen; este módulo nunca los escribe.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Devolucion.name, schema: DevolucionSchema },
      { name: DevolucionAcumulado.name, schema: DevolucionAcumuladoSchema },
      { name: Kardex.name, schema: KardexSchema },
      { name: Producto.name, schema: ProductoSchema },
      { name: Almacen.name, schema: AlmacenSchema },
      { name: Contenedor.name, schema: ContenedorSchema },
      { name: TurnoCaja.name, schema: TurnoCajaSchema },
      { name: Venta.name, schema: VentaSchema },
      { name: Pago.name, schema: PagoSchema },
      { name: Factura.name, schema: FacturaSchema },
      { name: RegistroCompra.name, schema: RegistroCompraSchema },
    ]),
    ConsecutivoModule,
    ExistenciaModule,
  ],
  controllers: [DevolucionController],
  providers: [
    DevolucionService,
    DevolucionOrigenService,
    DevolucionRecuperacionCron,
  ],
  exports: [DevolucionService],
})
export class DevolucionModule {}
