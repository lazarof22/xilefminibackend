import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EmpresaDatosDocument = HydratedDocument<EmpresaDatos>;

@Schema({ timestamps: true, collection: 'empresa_datos' })
export class EmpresaDatos {
  @Prop({ required: true })
  nombre?: string;

  @Prop()
  eslogan?: string;

  @Prop()
  direccion?: string;

  @Prop()
  telefono?: string;

  @Prop()
  email?: string;

  @Prop()
  ruc_nit?: string;

  /** Código de la entidad (REEUP): los modelos SC-2 lo exigen en cada documento. */
  @Prop()
  codigo_entidad?: string;

  /**
   * Nombre imprimible de la ciudad. Es el texto libre de los documentos
   * antiguos y, cuando hay `ciudadId`, una copia del nombre del nomenclador.
   * La factura toma de aquí el emisor, así que siempre debe ser un string.
   */
  @Prop()
  ciudad?: string;

  /** Referencia al nomenclador Ciudad (doc §6.7). Ausente en datos antiguos. */
  @Prop({ type: Types.ObjectId, ref: 'Ciudad' })
  ciudadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Pais' })
  pais?: Types.ObjectId;

  @Prop()
  logo?: string;
}

export const EmpresaDatosSchema = SchemaFactory.createForClass(EmpresaDatos);
