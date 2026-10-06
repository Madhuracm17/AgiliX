import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { SprintsModule } from './sprints/sprints.module';
import { AiModule } from './ai/ai.module';
import { TimeEntriesModule } from './time-entries/time-entries.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { ReportsModule } from './reports/reports.module';
import { AccessModule } from './auth/access.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { TeamInvitesModule } from './team-invites/team-invites.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/agilix',
    ),
    UsersModule,
    ProjectsModule,
    TasksModule,
    SprintsModule,
    AiModule,
    TimeEntriesModule,
    AnalyticsModule,
    AuthModule,
    ReportsModule,
    AccessModule,
    NotificationsModule,
    ApprovalsModule,
    TeamInvitesModule,
  ],
})
export class AppModule {}