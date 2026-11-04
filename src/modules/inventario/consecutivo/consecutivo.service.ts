import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConsecutivoDocumento } from './consecutivo.schema';

/** Document types that own an independent correlative sequence. */
export type ClaveConsecutivo =
  | 'recepcion'
  | 'devolucion'
  | 'ajuste'
  | 'arqueo'
  | (string & {});

@Injectable()
export class ConsecutivoService {
  constructor(
    @InjectModel(ConsecutivoDocumento.name)
    private readonly consecutivoModel: Model<ConsecutivoDocumento>,
  ) {}

  /**
   * Atomically allocates the next number of a document type and formats it
   * as `PREFIJO-000123`. A burned number (failed save) is never reused.
   */
  async siguiente(clave: ClaveConsecutivo, prefijo: string): Promise<string> {
    const contador = await this.consecutivoModel
      .findOneAndUpdate(
        { _id: clave },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      )
      .orFail()
      .exec();
    return `${prefijo}-${String(contador.seq).padStart(6, '0')}`;
  }
}
