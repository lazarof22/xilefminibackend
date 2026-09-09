import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";


export type EmpresaDocument = HydratedDocument<Empresa>;

export enum tipoEmpresa {
    MYPIME = 'mypime',
    TCP = 'tcp',
    ESTATAL = 'estatal',
    PRIVADA = 'privada',
    COOPERATIVA = 'cooperativa',
}



@Schema()
export class Empresa {
    @Prop({ required: true, unique: true })
    nombreEmpresa!: string;

    @Prop({ required: false, unique: true, sparse: true })
    emailEmpresa!: string;

    @Prop({ requirec: true, unique: true })
    direccionEmpresa!: string;

    @Prop({ unique: true, required: true })
    telefonoEmpresa!: string;

    @Prop({ required: true, unique: true })
    cuentaBancaria!: string;

    @Prop({ required: true, unique: true })
    codigoREU!: string;

    @Prop({ enum: tipoEmpresa, required: true, unique: true })
    tipoEmpresa!: tipoEmpresa;

    @Prop({required:false})
    sloganEmpresa!: string;

    @Prop({required:false})
    ciudadEmpresa!:string;

    @Prop({ type: Types.ObjectId, ref: 'Pais', required: false })
    paisEmpresa!:Types.ObjectId


}

export const EmpresaSchema = SchemaFactory.createForClass(Empresa);