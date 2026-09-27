import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export class UpdateBrandingDto {
  @ApiPropertyOptional({ example: 'Acme Trader' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  appName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  logoDarkUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  faviconUrl?: string;

  @ApiPropertyOptional({ example: '#1B2A4A' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'primaryColor must be a hex color' })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#0F172A' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'secondaryColor must be a hex color' })
  secondaryColor?: string;

  @ApiPropertyOptional({ example: '#22C55E' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'accentColor must be a hex color' })
  accentColor?: string;

  @ApiPropertyOptional({ example: '#FFFFFF' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'backgroundColor must be a hex color' })
  backgroundColor?: string;

  @ApiPropertyOptional({ example: '#0B1220' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'textColor must be a hex color' })
  textColor?: string;

  @ApiPropertyOptional({ example: 'Inter' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fontFamily?: string;

  @ApiPropertyOptional({ enum: ['light', 'dark', 'system'] })
  @IsOptional()
  @IsIn(['light', 'dark', 'system'])
  themeMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(254)
  supportEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  supportUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  termsUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  privacyUrl?: string;

  @ApiPropertyOptional({
    description: 'Custom CSS. Sanitised server-side: @import, url() and script vectors are removed.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  customCss?: string;

  @ApiPropertyOptional({ description: 'Map of social network to profile URL.' })
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;
}
