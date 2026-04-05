import {
  Controller,
  Delete,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ConnectionsService } from './connections.service';

@Controller('analytics/connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(private connectionsService: ConnectionsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.connectionsService.findAllByUser(req.user.id);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.connectionsService.deleteConnection(id, req.user.id);
  }
}
