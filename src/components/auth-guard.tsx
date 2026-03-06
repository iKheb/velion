import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";

export function AuthGuard() {
  const { profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Skeleton className="h-screen w-full" />;
  }

  if (!profile) {
    return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

