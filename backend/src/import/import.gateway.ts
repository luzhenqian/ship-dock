import { WebSocketGateway, WebSocketServer, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class ImportGateway {
  @WebSocketServer() server: Server;

  @SubscribeMessage('join-import')
  handleJoinImport(client: Socket, importId: string) {
    client.join(`import:${importId}`);
  }

  @SubscribeMessage('leave-import')
  handleLeaveImport(client: Socket, importId: string) {
    client.leave(`import:${importId}`);
  }

  emitToImport(importId: string, event: string, data: any) {
    if (this.server) this.server.to(`import:${importId}`).emit(event, data);
  }
}
