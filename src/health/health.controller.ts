import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness/readiness probe (checks database connectivity)' })
  @ApiOkResponse({
    schema: { example: { data: { status: 'ok', database: 'up', uptimeSeconds: 123 } } },
  })
  @ApiServiceUnavailableResponse({ description: 'Database unreachable' })
  async check(): Promise<{ status: 'ok'; database: 'up'; uptimeSeconds: number }> {
    if (!(await this.prisma.isHealthy())) {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return { status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()) };
  }
}
