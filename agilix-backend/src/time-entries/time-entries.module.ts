import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TimeEntry, TimeEntrySchema } from './schemas/time-entry.schema';
import { TimeEntriesService } from './time-entries.service';
import { TimeEntriesController } from './time-entries.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TimeEntry.name, schema: TimeEntrySchema }]),
  ],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService],
  exports: [TimeEntriesService],
})
export class TimeEntriesModule {}