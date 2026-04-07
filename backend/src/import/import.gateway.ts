import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class ImportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_SECRET'),
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('join-import')
  handleJoinImport(client: Socket, importId: string) {
    client.join(`import:${importId}`);
  }

  @SubscribeMessage('leave-import')
  handleLeaveImport(client: Socket, importId: string) {
    client.leave(`import:${importId}`);
  }

  emitProgress(importId: string, data: any) {
    if (this.server) {
      this.server.to(`import:${importId}`).emit('import:progress', data);
    }
  }

  emitLog(importId: string, data: any) {
    if (this.server) {
      this.server.to(`import:${importId}`).emit('import:log', data);
    }
  }

  emitStatus(importId: string, data: any) {
    if (this.server) {
      this.server.to(`import:${importId}`).emit('import:status', data);
    }
  }

  emitUploadComplete(importId: string) {
    if (this.server) {
      this.server
        .to(`import:${importId}`)
        .emit('import:upload-complete', { importId });
    }
  }
}
