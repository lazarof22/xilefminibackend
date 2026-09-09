import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LicenciaModule } from './modules/licencia/licencia.module';
import { AuthModule } from './modules/auth/auth.module';
import { VentaModule } from './modules/inventario/venta/venta.module';
import { PagoModule } from './modules/inventario/pago/pago.module';
import { CuadreCajaModule } from './modules/inventario/cuadre_caja/cuadre_caja.module';
import { ExtraccionModule } from './modules/inventario/extraccion/extraccion.module';
import { ReportePlusModule } from './modules/inventario/reporte_plus/reporte_plus.module';
import { KardexModule } from './modules/inventario/kardex/kardex.module';
import { ProductoModule } from './modules/inventario/producto/producto.module';
import { AlmacenModule } from './modules/inventario/almacen/almacen.module';
import { ContenedorModule } from './modules/inventario/contenedor/contenedor.module';
import { CompraModule } from './modules/compra/compra/compra.module';
import { ClienteModule } from './modules/clientes y provedores/cliente/cliente.module';
import { EmpresaModule } from './modules/clientes y provedores/empresa/empresa.module';
import { MonedaModule } from './modules/nomencladores/moneda/moneda.module';
import { EstadoModule } from './modules/nomencladores/estado/estado.module';
import { CategoriaModule } from './modules/nomencladores/categoria/categoria.module';
import { CargoEmpleadoModule } from './modules/nomencladores/cargo_empleado/cargo_empleado.module';
import { DepartamentoModule } from './modules/nomencladores/departamento/departamento.module';
import { PaisModule } from './modules/nomencladores/pais/pais.module';
import { UsuariosModule } from './modules/configuracion/usuarios/usuarios.module';
import { EmpresaDatosModule } from './modules/configuracion/empresa-datos/empresa-datos.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 30,
      },
    ]),
    LicenciaModule,
    AuthModule,
    VentaModule,
    PagoModule,
    CuadreCajaModule,
    ExtraccionModule,
    ReportePlusModule,
    KardexModule,
    ProductoModule,
    AlmacenModule,
    ContenedorModule,
    CompraModule,
    ClienteModule,
    EmpresaModule,
    MonedaModule,
    EstadoModule,
    CategoriaModule,
    CargoEmpleadoModule,
    DepartamentoModule,
    PaisModule,
    UsuariosModule,
    EmpresaDatosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
