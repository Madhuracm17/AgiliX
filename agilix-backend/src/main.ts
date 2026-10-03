import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

/** Any port on this computer, e.g. the Vite dev server. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Browsers may only call this backend from allowed web addresses.
 *
 *  - CORS_ORIGINS in .env (comma separated, e.g. https://agilix.example.com)
 *    lists the only addresses allowed. Set it when the app is deployed.
 *  - When it is not set, only pages running on this computer (localhost) are
 *    allowed, so nothing needs configuring for development.
 *
 * Requests with no Origin header (curl, Postman, the MCP server) are not affected.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const listed = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return listed.length > 0 ? listed.includes(origin) : LOCAL_ORIGIN.test(origin);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Agilix backend running on http://localhost:${port}`);
}
bootstrap();
