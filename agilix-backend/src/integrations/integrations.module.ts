import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GithubActivityService } from './github/github-activity.service';
import { GithubController } from './github/github.controller';
import { GithubMcpClient } from './github/github-mcp.client';
import { CalendarConnection, CalendarConnectionSchema } from './google-calendar/calendar-connection.schema';
import { GoogleCalendarClient } from './google-calendar/google-calendar.client';
import { GoogleCalendarController } from './google-calendar/google-calendar.controller';
import { GoogleCalendarService } from './google-calendar/google-calendar.service';

/**
 * Outside data sources: GitHub (AgiliX as an MCP CLIENT of GitHub's MCP server)
 * and Google Calendar (each person connects their own calendar with OAuth).
 * Their data feeds sprint health and burnout risk.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: CalendarConnection.name, schema: CalendarConnectionSchema }])],
  controllers: [GithubController, GoogleCalendarController],
  providers: [GithubMcpClient, GithubActivityService, GoogleCalendarClient, GoogleCalendarService],
  exports: [GithubMcpClient, GithubActivityService, GoogleCalendarService],
})
export class IntegrationsModule {}
