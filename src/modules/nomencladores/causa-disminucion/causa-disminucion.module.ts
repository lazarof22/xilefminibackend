import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CausaDisminucionController } from './causa-disminucion.controller';
import { CausaDisminucionService } from './causa-disminucion.service';
import {
  CausaDisminucion,
  CausaDisminucionSchema,
} from './schema/causa-disminucion.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CausaDisminucion.name, schema: CausaDisminucionSchema },
    ]),
  ],
  controllers: [CausaDisminucionController],
  providers: [CausaDisminucionService],
  exports: [MongooseModule, CausaDisminucionService],
})
export class CausaDisminucionModule {}
