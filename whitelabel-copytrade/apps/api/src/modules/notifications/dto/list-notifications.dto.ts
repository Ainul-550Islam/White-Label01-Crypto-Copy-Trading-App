import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { NotificationChannel } from '@wlct/shared-types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Return only unread notifications.', default: false })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : Boolean(value)))
  @IsBoolean()
  unreadOnly: boolean = false;

  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;
}
