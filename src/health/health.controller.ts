import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RawResponse } from '../common/http/raw-response.decorator.js';
import { HealthLiveResponseDto } from './health-live-response.dto.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get('live')
  @HttpCode(200)
  @RawResponse()
  @ApiOperation({ summary: 'Check whether the process is responding' })
  @ApiOkResponse({ type: HealthLiveResponseDto })
  live(): HealthLiveResponseDto {
    return { status: 'ok' };
  }
}
