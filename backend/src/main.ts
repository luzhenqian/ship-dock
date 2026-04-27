import { NestFactory } from '@nestjs/core';
import { ValidationPipe, INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';

// BigInt cannot be serialized by JSON.stringify by default
(BigInt.prototype as any).toJSON = function () { return Number(this); };

// Mount Socket.IO under /api/socket.io/ so nginx's /api/ proxy handles WS too.
// Otherwise the default /socket.io/ falls through to the frontend (Next.js)
// which doesn't serve it, and live log streaming silently dies.
class ApiPathIoAdapter extends IoAdapter {
  constructor(app: INestApplicationContext) { super(app); }
  createIOServer(port: number, options?: ServerOptions): any {
    return super.createIOServer(port, { ...options, path: '/api/socket.io/' });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  app.useWebSocketAdapter(new ApiPathIoAdapter(app));
  await app.listen(process.env.PORT || 4000);
}
bootstrap();
