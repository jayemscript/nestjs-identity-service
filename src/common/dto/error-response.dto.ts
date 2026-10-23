import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'BAD_REQUEST' })
  code!: string;

  @ApiProperty({ example: 'Bad request' })
  message!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ description: 'Request correlation identifier' })
  requestId!: string;

  @ApiPropertyOptional({
    description: 'Field names mapped to validation rule identifiers',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  details?: Record<string, string[]>;
}
