import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LogsService } from './logs.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class LogsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private clientProjects = new Map<string, string>();

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private logsService: LogsService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) { client.disconnect(); return; }
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_SECRET'),
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const projectId = this.clientProjects.get(client.id);
    if (projectId) {
      client.leave(`logs:${projectId}`);
      this.clientProjects.delete(client.id);
      const room = this.server.sockets.adapter.rooms.get(`logs:${projectId}`);
      if (!room || room.size === 0) {
        this.logsService.stopTail(projectId);
      }
    }
  }

  @SubscribeMessage('join-logs')
  async handleJoinLogs(client: Socket, projectId: string) {
    if (!client.data.userId) return;

    client.join(`logs:${projectId}`);
    this.clientProjects.set(client.id, projectId);

    const room = this.server.sockets.adapter.rooms.get(`logs:${projectId}`);
    if (room && room.size === 1) {
      await this.logsService.startTail(projectId, (data) => {
        this.server.to(`logs:${projectId}`).emit('log-line', data);
      });
    }
  }

  @SubscribeMessage('leave-logs')
  handleLeaveLogs(client: Socket, projectId: string) {
    client.leave(`logs:${projectId}`);
    this.clientProjects.delete(client.id);

    const room = this.server.sockets.adapter.rooms.get(`logs:${projectId}`);
    if (!room || room.size === 0) {
      this.logsService.stopTail(projectId);
    }
  }
}
