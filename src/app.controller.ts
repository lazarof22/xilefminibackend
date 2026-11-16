import { Controller, Get } from '@nestjs/common';
import { SinLicencia } from './modules/licencia/decorators/sin-licencia.decorator';
import { AppService } from './app.service';

@SinLicencia()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
