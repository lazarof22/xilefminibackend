import { Module } from '@nestjs/common';
import { NomencladorHelper } from './nomenclador-helper.service';
import { PaisModule } from '../../nomencladores/pais/pais.module';
import { CategoriaModule } from '../../nomencladores/categoria/categoria.module';
import { EstadoModule } from '../../nomencladores/estado/estado.module';
import { DepartamentoModule } from '../../nomencladores/departamento/departamento.module';
import { CargoEmpleadoModule } from '../../nomencladores/cargo_empleado/cargo_empleado.module';
import { NaturalezaCuentaModule } from '../../nomencladores/naturaleza-cuenta/naturaleza-cuenta.module';
import { ElementoGastoModule } from '../../nomencladores/elemento-gasto/elemento-gasto.module';
import { ComprobanteTipoModule } from '../../nomencladores/comprobante-tipo/comprobante-tipo.module';

@Module({
  imports: [
    PaisModule,
    CategoriaModule,
    EstadoModule,
    DepartamentoModule,
    CargoEmpleadoModule,
    NaturalezaCuentaModule,
    ElementoGastoModule,
    ComprobanteTipoModule,
  ],
  providers: [NomencladorHelper],
  exports: [NomencladorHelper],
})
export class NomencladorHelperModule {}
