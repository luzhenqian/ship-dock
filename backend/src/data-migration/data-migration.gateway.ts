import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class DataMigrationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private jwt: JwtService, private config: ConfigService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) { client.disconnect(); return; }
      const payload = await this.jwt.verifyAsync(token, { secret: this.config.getOrThrow('JWT_SECRET') });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch { client.disconnect(); }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('join-migration')
  handleJoinMigration(client: Socket, migrationId: string) { client.join(`migration:${migrationId}`); }

  @SubscribeMessage('leave-migration')
  handleLeaveMigration(client: Socket, migrationId: string) { client.leave(`migration:${migrationId}`); }

  emitToMigration(migrationId: string, event: string, data: any) {
    if (this.server) this.server.to(`migration:${migrationId}`).emit(event, data);
  }
}
