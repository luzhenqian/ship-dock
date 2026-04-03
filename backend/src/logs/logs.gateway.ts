import {
  WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LogsService } from './logs.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class LogsGateway implements OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private clientProjects = new Map<string, string>();

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private logsService: LogsService,
  ) {}

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
