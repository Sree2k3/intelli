import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Permission, hasPermission } from "@/lib/permissions";

interface PermissionGateProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * PermissionGate - Wrapper component to conditionally render UI based on user permissions.
 */
export const PermissionGate = ({ permission, children, fallback = null }: PermissionGateProps) => {
  const { user } = useAuth();
  
  if (hasPermission(user?.role, permission)) {
    return <>{children}</>;
  }
  
  return <>{fallback}</>;
};
