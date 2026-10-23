import { ApiProperty } from '@nestjs/swagger';

export class HealthLiveResponseDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';
}
