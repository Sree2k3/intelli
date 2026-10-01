export type Role = 'super_admin' | 'admin' | 'manager' | 'recruiter';

export type Permission = 
  | 'create_tenant'
  | 'add_admin'
  | 'add_staff'
  | 'create_interview'
  | 'view_tenant_interviews'
  | 'view_own_interviews'
  | 'view_reports'
  | 'view_dashboard'
  | 'manage_tenant_settings';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    'create_tenant',
    'add_admin',
    'view_dashboard',
    'manage_tenant_settings'
  ],
  admin: [
    'add_admin',
    'add_staff',
    'create_interview',
    'view_tenant_interviews',
    'view_own_interviews',
    'view_reports',
    'view_dashboard',
    'manage_tenant_settings'
  ],
  manager: [
    'add_staff',
    'create_interview',
    'view_tenant_interviews',
    'view_own_interviews',
    'view_reports',
    'view_dashboard'
  ],
  recruiter: [
    'create_interview',
    'view_own_interviews',
    'view_reports'
  ]
};

export const hasPermission = (role: string | undefined, permission: Permission): boolean => {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as Role];
  return perms?.includes(permission) || false;
};
