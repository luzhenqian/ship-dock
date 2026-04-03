import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' } })
export class DeployGateway implements OnGatewayConnection, OnGatewayDisconnect {
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

  handleDisconnect(client: Socket) {}

  @SubscribeMessage('join-deployment')
  handleJoinDeployment(client: Socket, deploymentId: string) { client.join(`deployment:${deploymentId}`); }

  @SubscribeMessage('leave-deployment')
  handleLeaveDeployment(client: Socket, deploymentId: string) { client.leave(`deployment:${deploymentId}`); }

  @SubscribeMessage('join-dashboard')
  handleJoinDashboard(client: Socket) { client.join('dashboard'); }

  emitToDeployment(deploymentId: string, event: string, data: any) {
    if (this.server) this.server.to(`deployment:${deploymentId}`).emit(event, data);
  }

  emitToDashboard(event: string, data: any) {
    if (this.server) this.server.to('dashboard').emit(event, data);
  }
}
