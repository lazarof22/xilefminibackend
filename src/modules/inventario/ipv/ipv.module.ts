import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IpvController } from './ipv.controller';
import { IpvService } from './ipv.service';
import { Ipv, IpvSchema } from './schema/ipv.schema';
import { Producto, ProductoSchema } from '../producto/schemas/producto.schema';
import { Venta, VentaSchema } from '../venta/schema/venta.schema';
import { Kardex, KardexSchema } from '../kardex/schema/kardex.schema';

@Module({
  controllers: [IpvController],
  providers: [IpvService],
  imports: [
    MongooseModule.forFeature([
      { name: Ipv.name, schema: IpvSchema },
      { name: Producto.name, schema: ProductoSchema },
      { name: Venta.name, schema: VentaSchema },
      { name: Kardex.name, schema: KardexSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class IpvModule {}
