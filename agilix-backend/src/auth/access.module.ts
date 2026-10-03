import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';

/** Makes AccessService available to every controller without importing it each time. */
@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
