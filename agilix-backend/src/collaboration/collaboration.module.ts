import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityController } from './activity.controller';
import { ActivityInterceptor } from './activity.interceptor';
import { ActivityService } from './activity.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { Activity, ActivitySchema } from './schemas/activity.schema';
import { Comment, CommentSchema } from './schemas/comment.schema';

/**
 * Collaboration: comments on tasks and the project activity log.
 *
 * The activity log is recorded by ActivityInterceptor, registered app-wide, so
 * the task, sprint, approval and team code did not have to change.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Comment.name, schema: CommentSchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
  ],
  controllers: [CommentsController, ActivityController],
  providers: [
    CommentsService,
    ActivityService,
    ActivityInterceptor,
    // Runs on every HTTP request (it only acts on the routes it tracks).
    { provide: APP_INTERCEPTOR, useExisting: ActivityInterceptor },
  ],
  exports: [CommentsService, ActivityService, ActivityInterceptor],
})
export class CollaborationModule {}
