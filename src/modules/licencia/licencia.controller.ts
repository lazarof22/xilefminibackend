import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LicenciaService } from './licencia.service';
import { ActivarLicenciaDto } from './dto/activar-licencia.dto';
import { SolicitudQueryDto } from './dto/solicitud-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import type { JwtUser } from '../auth/types/jwt-user.type';
import type {
  ContextoPeticion,
  EstadoPublicoResponse,
  EstadoUsuarioResponse,
  ImportacionResponse,
  LicenciaAdminResponse,
  SolicitudLicencia,
} from './types/licencia.types';
import type { AuditoriaLicenciaDocument } from './schemas/auditoria-licencia.schema';

export interface RequestConUsuario {
  user: JwtUser;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
}

/** Minimal response surface used to set the download header. */
export interface HeaderWriter {
  setHeader(name: string, value: string): unknown;
}

const ADMIN = 'administrador';

function contexto(req: RequestConUsuario): ContextoPeticion {
  const raw = req.headers?.['user-agent'];
  return {
    empresaIdUsuario: req.user.empresa_id,
    ip: req.ip,
    userAgent: Array.isArray(raw) ? raw[0] : raw,
  };
}

@ApiTags('Licencias')
@Controller('licencia')
@UseGuards(ThrottlerGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class LicenciaController {
  constructor(private readonly licenciaService: LicenciaService) {}

  @Get('public/estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public license status of this install: { valida, estado } only',
  })
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  estadoPublico(): Promise<EstadoPublicoResponse> {
    return this.licenciaService.estadoPublico();
  }

  @Get('estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'License status for the empresa of the JWT' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  verificarEstado(
    @Req() req: RequestConUsuario,
  ): Promise<EstadoUsuarioResponse> {
    return this.licenciaService.estadoUsuario(req.user.empresa_id);
  }

  @Get('solicitud')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Activation request (.req) with the server-computed hardware fingerprint (admin)',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async solicitud(
    @Query() query: SolicitudQueryDto,
    @Req() req: RequestConUsuario,
    @Res({ passthrough: true }) res: HeaderWriter,
  ): Promise<SolicitudLicencia> {
    const empresaId = query.empresa_id ?? req.user.empresa_id;
    if (!empresaId) {
      throw new BadRequestException('empresa_id requerido (query o JWT)');
    }
    const solicitud = await this.licenciaService.generarSolicitud(
      empresaId,
      contexto(req),
    );
    if (query.descargar === 'true') {
      const safe = empresaId.replace(/[^A-Za-z0-9._-]/g, '_');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="xilef-${safe}.req"`,
      );
    }
    return solicitud;
  }

  @Post('activar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Import a signed .lic artifact (admin)' })
  @ApiResponse({
    status: 200,
    description: 'activada | actualizada | revocada | reimportada',
  })
  @ApiResponse({
    status: 400,
    description:
      'formato_invalido | version_no_soportada | firma_invalida | expirada',
  })
  @ApiResponse({
    status: 403,
    description:
      'hardware_no_coincide | empresa_no_coincide | reloj_alterado | estado_alterado',
  })
  @ApiResponse({
    status: 409,
    description: 'secuencia_obsoleta (anti-rollback)',
  })
  @ApiResponse({
    status: 500,
    description: 'archivo_no_escrito | error_interno',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ADMIN)
  @Throttle({ default: { ttl: 900_000, limit: 10 } })
  activar(
    @Body() dto: ActivarLicenciaDto,
    @Req() req: RequestConUsuario,
  ): Promise<ImportacionResponse> {
    const artifact = {
      version_firma: dto.version_firma,
      payload: { ...dto.payload },
      firma: dto.firma,
    };
    return this.licenciaService.importarLicencia(artifact, contexto(req));
  }

  @Get('admin/auditoria')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'License audit trail (admin)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max 100 (default 100)',
  })
  @ApiQuery({ name: 'offset', required: false, description: 'Default 0' })
  @ApiQuery({ name: 'empresa_id', required: false })
  @ApiQuery({ name: 'accion', required: false })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ADMIN)
  auditoria(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('empresa_id') empresaId?: string,
    @Query('accion') accion?: string,
  ): Promise<AuditoriaLicenciaDocument[]> {
    return this.licenciaService.getAuditoria({
      limit,
      offset,
      empresa_id: empresaId,
      accion,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'All stored licenses with derived status (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ADMIN)
  listarTodas(): Promise<LicenciaAdminResponse[]> {
    return this.licenciaService.findAll();
  }

  // Parametric route declared LAST so it does not shadow static routes.
  @Get(':empresaId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'License of an empresa with derived status (admin)',
  })
  @ApiParam({ name: 'empresaId' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ADMIN)
  obtenerUna(
    @Param('empresaId') empresaId: string,
  ): Promise<LicenciaAdminResponse | null> {
    return this.licenciaService.findOne(empresaId);
  }
}
