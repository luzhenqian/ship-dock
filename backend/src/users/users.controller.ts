import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { CreateInviteDto, AcceptInviteDto } from '../auth/dto/invite.dto';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @MinRole('ADMIN')
  listUsers() { return this.usersService.listUsers(); }

  @Patch(':id/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @MinRole('ADMIN')
  updateRole(@Param('id') id: string, @Body('role') role: string) { return this.usersService.updateRole(id, role); }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @MinRole('ADMIN')
  deleteUser(@Param('id') id: string) { return this.usersService.deleteUser(id); }

  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @MinRole('ADMIN')
  createInvite(@Req() req: any, @Body() dto: CreateInviteDto) { return this.usersService.createInvite(req.user.id, dto); }

  @Post('invite/accept')
  acceptInvite(@Body() dto: AcceptInviteDto) { return this.usersService.acceptInvite(dto); }
}
