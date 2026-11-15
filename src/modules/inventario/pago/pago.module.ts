import { Module } from '@nestjs/common';
import { PagoService } from './pago.service';
import { PagoController } from './pago.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Pago, PagoSchema } from './schema/pago.schema';
import {
  PagoEfectivoSchema,
  PagoEfectivo,
} from './schema/pago_efectivo.schema';
import { PagoCredito, PagoCreditoSchema } from './schema/pago_credito.schema';
import {
  PagoTransferencia,
  PagoTransferenciaSchema,
} from './schema/pago_transferencia.schema';
import {
  Cliente,
  ClienteSchema,
} from 'src/modules/clientes y provedores/cliente/schemas/cliente.schema';
import { Venta, VentaSchema } from '../venta/schema/venta.schema';
import {
  Moneda,
  MonedaSchema,
} from '../../nomencladores/moneda/schema/moneda.schema';
import { BancoModule } from '../../nomencladores/banco/banco.module';
import { DenominacionMonedaModule } from '../../nomencladores/denominacion-moneda/denominacion-moneda.module';
import { ConfiguracionPagosModule } from '../../configuracion-pagos/configuracion-pagos.module';
import { TasaModule } from '../../tasa/tasa.module';
import { MonedaPagoService } from './moneda-pago.service';

@Module({
  controllers: [PagoController],
  providers: [PagoService, MonedaPagoService],

  imports: [
    MongooseModule.forFeature([
      {
        name: Pago.name,
        schema: PagoSchema,
        discriminators: [
          { name: PagoEfectivo.name, schema: PagoEfectivoSchema },
          { name: PagoCredito.name, schema: PagoCreditoSchema },
          { name: PagoTransferencia.name, schema: PagoTransferenciaSchema },
        ],
      },
      { name: Cliente.name, schema: ClienteSchema },
      { name: Venta.name, schema: VentaSchema },
      { name: Moneda.name, schema: MonedaSchema },
    ]),
    TasaModule,
    DenominacionMonedaModule,
    BancoModule,
    ConfiguracionPagosModule,
  ],
  exports: [MongooseModule, PagoService, MonedaPagoService],
})
export class PagoModule {}
