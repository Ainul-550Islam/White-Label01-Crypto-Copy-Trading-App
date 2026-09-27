import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    description: 'Stable identifier in UPPER_SNAKE_CASE. Cannot be changed later.',
    example: 'RISK_ANALYST',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z][A-Z0-9_]*$/, { message: 'Role keys must be UPPER_SNAKE_CASE' })
  key!: string;

  @ApiProperty({ description: 'Human readable name.', example: 'Risk Analyst' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'What this role is for.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'Permission keys granted by this role, in "resource:action" form.',
    example: ['position:read', 'report:read'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Matches(/^(\*|[a-z][a-z0-9_]*:(\*|[a-z][a-z0-9_]*))$/, {
    each: true,
    message: 'Permissions must use the "resource:action" form',
  })
  permissionKeys!: string[];
}
