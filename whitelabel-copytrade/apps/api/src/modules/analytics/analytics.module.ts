// # Responsibility: registers platform analytics aggregation and its authorized read-only endpoints.
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { BusinessKpiController } from './business-kpi.controller';
import { BusinessKpiService } from './business-kpi.service';
@Module({ imports: [PrismaModule], controllers: [BusinessKpiController], providers: [BusinessKpiService], exports: [BusinessKpiService] })
export class AnalyticsModule {}
