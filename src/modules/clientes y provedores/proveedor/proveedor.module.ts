import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Proveedor, ProveedorSchema } from './schema/proveedor.schema';
import { ProveedorController } from './proveedor.controller';
import { ProveedorService } from './proveedor.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Proveedor.name, schema: ProveedorSchema },
    ]),
  ],
  controllers: [ProveedorController],
  providers: [ProveedorService],
  exports: [MongooseModule],
})
export class ProveedorModule {}
