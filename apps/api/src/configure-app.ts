import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureApp(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.useBodyParser('json', { limit: '7mb' });
  app.useGlobalFilters(new ApiExceptionFilter());
}
