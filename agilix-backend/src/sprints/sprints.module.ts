import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Sprint, SprintSchema } from './schemas/sprint.schema';
import { SprintsService } from './sprints.service';
import { SprintsController } from './sprints.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Sprint.name, schema: SprintSchema }])],
  controllers: [SprintsController],
  providers: [SprintsService],
  exports: [SprintsService],
})
export class SprintsModule {}
