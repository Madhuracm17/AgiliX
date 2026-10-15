import { Module } from '@nestjs/common';
import { GithubActivityService } from './github/github-activity.service';
import { GithubController } from './github/github.controller';
import { GithubMcpClient } from './github/github-mcp.client';

/**
 * Outside data sources, reached as an MCP CLIENT (AgiliX calls other MCP servers):
 * GitHub now, Google Calendar next. Their data feeds sprint health and burnout risk.
 */
@Module({
  controllers: [GithubController],
  providers: [GithubMcpClient, GithubActivityService],
  exports: [GithubMcpClient, GithubActivityService],
})
export class IntegrationsModule {}
