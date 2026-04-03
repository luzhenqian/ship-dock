import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const MinRole = (role: string) => SetMetadata(ROLES_KEY, role);
