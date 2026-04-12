import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class StorageImportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private jwt: JwtService, private config: ConfigService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) { client.disconnect(); return; }
      await this.jwt.verifyAsync(token, { secret: this.config.getOrThrow('JWT_SECRET') });
    } catch { client.disconnect(); }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('join-storage-import')
  handleJoin(client: Socket, importId: string) { client.join(`storage-import:${importId}`); }

  @SubscribeMessage('leave-storage-import')
  handleLeave(client: Socket, importId: string) { client.leave(`storage-import:${importId}`); }

  emit(importId: string, event: string, data: any) {
    if (this.server) this.server.to(`storage-import:${importId}`).emit(event, data);
  }
}
