import { Body, Controller, Delete, Get, Header, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';

/** Comments on tasks: anyone on the project's team. */
@Controller('comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  /** `?tasks=id1,id2,...` → { id1: 3, id2: 0 } (one request for a whole board). */
  @Header('Cache-Control', 'no-store')
  @Get('counts')
  counts(@Query('tasks') tasks: string | undefined, @CurrentUser() user: AuthUser) {
    return this.comments.counts(user, tasks);
  }

  @Header('Cache-Control', 'no-store')
  @Get('task/:taskId')
  list(@Param('taskId') taskId: string, @CurrentUser() user: AuthUser) {
    return this.comments.list(user, taskId);
  }

  @Post('task/:taskId')
  create(@Param('taskId') taskId: string, @Body() dto: CreateCommentDto, @CurrentUser() user: AuthUser) {
    return this.comments.create(user, taskId, dto.text);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.comments.remove(user, id);
  }
}
