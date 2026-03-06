import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "@/layouts/app-sidebar";
import { RightPanel } from "@/layouts/right-panel";
import { MobileBottomNav } from "@/layouts/mobile-bottom-nav";
import { usePresence } from "@/hooks/usePresence";
import { trackPageView } from "@/services/analytics.service";

export function AppShell() {
  const location = useLocation();
  usePresence();

  useEffect(() => {
    trackPageView(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen lg:pl-72 xl:pr-72">
      <AppSidebar />
      <main className="mx-auto w-full max-w-6xl p-4 pb-24 lg:px-8 lg:py-6">
        <div className="mx-auto w-full max-w-5xl">
          <Outlet />
        </div>
      </main>
      <RightPanel />
      <MobileBottomNav />
    </div>
  );
}
