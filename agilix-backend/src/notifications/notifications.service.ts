import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';

export interface NewNotification {
  text: string;
  detail?: string;
  link?: string;
  kind: 'review_returned' | 'approval_requested' | 'approval_decided';
}

/** How many of a person's newest notifications the bell receives. */
const LIST_LIMIT = 30;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    @InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>,
  ) {}

  /**
   * Sends one notification to each person. It never throws: a notification that
   * fails must not undo the task move or approval that caused it.
   */
  async notify(userIds: string[], notification: NewNotification): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;
    try {
      await this.notificationModel.insertMany(
        unique.map((user) => ({
          user,
          text: notification.text,
          detail: notification.detail ?? '',
          link: notification.link ?? '',
          kind: notification.kind,
        })),
      );
    } catch (error) {
      this.logger.warn(`Could not save a notification: ${String(error)}`);
    }
  }

  /** The person's own newest notifications. */
  listFor(userId: string) {
    return this.notificationModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(LIST_LIMIT)
      .select('text detail link kind createdAt')
      .lean()
      .exec();
  }
}
