import type { UserRole } from '@/types';

export function homeFor(role: UserRole): string {
  return role === 'carnicero' ? '/despiece' : '/pos';
}

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrador',
  cajero: 'Cajero',
  carnicero: 'Carnicero',
};
