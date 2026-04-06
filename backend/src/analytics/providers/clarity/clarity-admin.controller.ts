import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';

/**
 * Clarity does not expose a public API for project management.
 * This controller is kept as a placeholder; project ID is entered
 * manually on the frontend.
 */
@Controller('analytics/clarity')
@UseGuards(JwtAuthGuard)
export class ClarityAdminController {}
