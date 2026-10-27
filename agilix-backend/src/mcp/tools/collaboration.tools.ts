import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ActivityService } from '../../collaboration/activity.service';
import { CommentsService } from '../../collaboration/comments.service';
import { defineMcpTool } from '../mcp-tool.types';
import { actingUser, objectId } from './tool-helpers';

export const listCommentsTool = defineMcpTool({
  name: 'agilix_list_comments',
  title: 'Comments on a task',
  description: 'Lists the comments on one task, oldest first, with author name and role and when it was written.',
  readOnly: true,
  inputSchema: { taskId: objectId('task') },
  handler: async ({ taskId }, ctx) => {
    const { user } = await actingUser(ctx);
    // CommentsService.list runs the same project-membership check as the web app.
    return ctx.get(CommentsService).list(user, taskId);
  },
});

export const projectActivityTool = defineMcpTool({
  name: 'agilix_get_activity',
  title: 'Project activity log',
  description:
    'Recent activity in a project, newest first: tasks created, moved, assigned, edited, deleted; sprints ' +
    'created, started, completed; approvals; team changes; comments. Each entry has who, what and when. ' +
    'Give a taskId instead to get the history of one task.',
  readOnly: true,
  inputSchema: {
    projectId: objectId('project').optional(),
    taskId: objectId('task').optional(),
    limit: z.number().int().min(1).max(200).optional().describe('How many entries (default 50).'),
  },
  handler: async ({ projectId, taskId, limit }, ctx) => {
    const { user, access } = await actingUser(ctx);
    const activity = ctx.get(ActivityService);
    if (taskId) {
      await access.assertTask(user, taskId);
      return activity.forTask(taskId);
    }
    if (!projectId) throw new BadRequestException('Give a projectId or a taskId.');
    await access.assertProject(user, projectId);
    return activity.forProject(projectId, limit);
  },
});
