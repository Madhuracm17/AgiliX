import { Controller, Get, Header } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt-config';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** The logged-in person's own notifications, newest first. */
  @Header('Cache-Control', 'no-store')
  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.notifications.listFor(user.userId);
  }
}
