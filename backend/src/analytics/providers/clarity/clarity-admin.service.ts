import { Injectable } from '@nestjs/common';

/**
 * Clarity does not expose a public API for project management.
 * Users create projects manually at https://clarity.microsoft.com
 * and enter the project ID in the setup flow.
 *
 * This service is kept as a placeholder for potential future
 * Data Export API integration.
 */
@Injectable()
export class ClarityAdminService {}
