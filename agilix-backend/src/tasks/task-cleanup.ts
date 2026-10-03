import { Types } from 'mongoose';
import type { Connection } from 'mongoose';

/**
 * Deletes a task and the time entries logged on it. Ids may be stored as
 * ObjectIds or as plain text in older records, so both forms are matched.
 * Returns false when the task did not exist.
 */
export async function deleteTaskAndTime(db: Connection, taskId: string): Promise<boolean> {
  const forms = [new Types.ObjectId(taskId), taskId] as never;
  const result = await db.model('Task').collection.deleteOne({ _id: new Types.ObjectId(taskId) } as never);
  await db.model('TimeEntry').collection.deleteMany({ task: { $in: forms } } as never);
  return result.deletedCount > 0;
}
