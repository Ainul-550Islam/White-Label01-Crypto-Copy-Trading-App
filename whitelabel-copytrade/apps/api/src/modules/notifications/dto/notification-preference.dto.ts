import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { NotificationChannel } from '@wlct/shared-types';

export class NotificationPreferenceEntryDto {
  @ApiProperty({ example: 'billing', description: 'Template category.' })
  @IsString()
  @MaxLength(48)
  category!: string;

  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    type: [NotificationPreferenceEntryDto],
    description:
      'Preferences to store. Security-critical notifications are always delivered regardless of these settings.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceEntryDto)
  preferences!: NotificationPreferenceEntryDto[];
}
