import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { resolvePostAuthPath } from "@/lib/auth-flow";

export const ProtectedRoute = () => {
    const { user, loading } = useAuth();
    const location = useLocation();
    const [checkingRoute, setCheckingRoute] = useState(true);
    const [redirectPath, setRedirectPath] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        if (loading) {
            return () => {
                active = false;
            };
        }

        if (!user) {
            setRedirectPath(null);
            setCheckingRoute(false);
            return () => {
                active = false;
            };
        }

        setCheckingRoute(true);

        void (async () => {
            try {
                const nextPath = await resolvePostAuthPath(user);
                if (!active) return;

                const currentPath = location.pathname;
                const isAdmin = nextPath === "/portal-select";
                const isAllowedAdminPath = isAdmin && (
                  currentPath.startsWith("/portal-select") ||
                  currentPath.startsWith("/admin") ||
                  currentPath.startsWith("/dashboard")
                );

                const shouldRedirect = nextPath && !isAllowedAdminPath && !currentPath.startsWith(nextPath);

                setRedirectPath(shouldRedirect ? nextPath : null);
            } catch {
                if (!active) return;
                setRedirectPath("/login"); // Safe fallback route to avoid unauthenticated dashboard access
            } finally {
                if (active) {
                    setCheckingRoute(false);
                }
            }
        })();

        return () => {
            active = false;
        };
    }, [loading, location.pathname, user]);

    if (loading) {
        return (
            <div className="h-[100dvh] w-full flex items-center justify-center bg-surface">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
                    <div className="w-6 h-6 rounded-lg bg-primary animate-bounce" />
                </div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    if (checkingRoute) {
        return (
            <div className="h-[100dvh] w-full flex items-center justify-center bg-surface">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
                    <div className="w-6 h-6 rounded-lg bg-primary animate-bounce" />
                </div>
            </div>
        );
    }

    if (redirectPath) {
        return <Navigate to={redirectPath} replace />;
    }

    return <Outlet />;
};
