import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResolveSecurityEventDto {
  @ApiProperty({
    description: 'Explanation of the investigation outcome, stored for compliance review.',
    example: 'Confirmed with the customer over the phone; legitimate travel.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  resolution!: string;
}
