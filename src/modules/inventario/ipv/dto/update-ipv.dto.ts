import { OmitType, PartialType } from '@nestjs/swagger';
import { IpvItemDto } from './ipv-item.dto';

export class UpdateIpvDto extends PartialType(
  OmitType(IpvItemDto, ['producto'] as const),
) {}
