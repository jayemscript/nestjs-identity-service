import { ApiProperty } from '@nestjs/swagger';

export class CommonResponseDto<T = unknown> {
  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: 'Success' })
  message!: string;

  @ApiProperty({ description: 'Endpoint-specific response data' })
  data!: T;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ description: 'Request correlation identifier' })
  requestId!: string;
}
