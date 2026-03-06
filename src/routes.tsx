import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import { AppShell } from "@/layouts/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteErrorBoundary } from "@/components/route-error-boundary";
import { isFeatureEnabled } from "@/config/feature-flags";

const LoginPage = lazy(() => import("@/pages/login-page"));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password-page"));
const TermsPage = lazy(() => import("@/pages/terms-page"));
const PrivacyPage = lazy(() => import("@/pages/privacy-page"));
const HomePage = lazy(() => import("@/pages/home-page"));
const ReelsPage = lazy(() => import("@/pages/reels-page"));
const StoriesPage = lazy(() => import("@/pages/stories-page"));
const StreamingPage = lazy(() => import("@/pages/streaming-page"));
const StreamingStudioPage = lazy(() => import("@/pages/streaming-studio-page"));
const StorePage = lazy(() => import("@/pages/store-page"));
const MessagesPage = lazy(() => import("@/pages/messages-page"));
const NotificationsPage = lazy(() => import("@/pages/notifications-page"));
const SupportPage = lazy(() => import("@/pages/support-page"));
const AccountSettingsPage = lazy(() => import("@/pages/account-settings-page"));
const ProfilePage = lazy(() => import("@/pages/profile-page"));
const AdminPage = lazy(() => import("@/pages/admin-page"));
const ChannelPage = lazy(() => import("@/pages/channel-page"));
const StreamVideoPage = lazy(() => import("@/pages/stream-video-page"));

const withSuspense = (node: ReactNode) => <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>{node}</Suspense>;
const streamsEnabled = isFeatureEnabled("streamsEnabled");
const supportEnabled = isFeatureEnabled("supportEnabled");
const moderationEnabled = isFeatureEnabled("moderationEnabled");
const walletEnabled = isFeatureEnabled("walletEnabled");

export const router = createBrowserRouter([
  { path: ROUTES.login, element: withSuspense(<LoginPage />), errorElement: <RouteErrorBoundary /> },
  { path: ROUTES.resetPassword, element: withSuspense(<ResetPasswordPage />), errorElement: <RouteErrorBoundary /> },
  { path: ROUTES.terms, element: withSuspense(<TermsPage />), errorElement: <RouteErrorBoundary /> },
  { path: ROUTES.privacy, element: withSuspense(<PrivacyPage />), errorElement: <RouteErrorBoundary /> },
  {
    element: <AuthGuard />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: ROUTES.home,
        element: <AppShell />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, element: withSuspense(<HomePage />), errorElement: <RouteErrorBoundary /> },
          { path: ROUTES.reels.slice(1), element: withSuspense(<ReelsPage />), errorElement: <RouteErrorBoundary /> },
          { path: ROUTES.stories.slice(1), element: withSuspense(<StoriesPage />), errorElement: <RouteErrorBoundary /> },
          ...(streamsEnabled
            ? [
                { path: ROUTES.streaming.slice(1), element: withSuspense(<StreamingPage />), errorElement: <RouteErrorBoundary /> },
                { path: ROUTES.streamingStudio.slice(1), element: withSuspense(<StreamingStudioPage />), errorElement: <RouteErrorBoundary /> },
                { path: "streaming/:id", element: withSuspense(<ChannelPage />), errorElement: <RouteErrorBoundary /> },
                { path: "streaming/video/:id", element: withSuspense(<StreamVideoPage />), errorElement: <RouteErrorBoundary /> },
              ]
            : []),
          ...(walletEnabled ? [{ path: ROUTES.store.slice(1), element: withSuspense(<StorePage />), errorElement: <RouteErrorBoundary /> }] : []),
          { path: `${ROUTES.messages.slice(1)}/:username`, element: withSuspense(<MessagesPage />), errorElement: <RouteErrorBoundary /> },
          { path: ROUTES.messages.slice(1), element: withSuspense(<MessagesPage />), errorElement: <RouteErrorBoundary /> },
          { path: ROUTES.notifications.slice(1), element: withSuspense(<NotificationsPage />), errorElement: <RouteErrorBoundary /> },
          ...(supportEnabled
            ? [
                { path: ROUTES.support.slice(1), element: withSuspense(<SupportPage />), errorElement: <RouteErrorBoundary /> },
                { path: `${ROUTES.support.slice(1)}/*`, element: withSuspense(<SupportPage />), errorElement: <RouteErrorBoundary /> },
                { path: "soporte", element: withSuspense(<SupportPage />), errorElement: <RouteErrorBoundary /> },
                { path: "soporte/*", element: withSuspense(<SupportPage />), errorElement: <RouteErrorBoundary /> },
              ]
            : []),
          { path: ROUTES.accountSettings.slice(1), element: withSuspense(<AccountSettingsPage />), errorElement: <RouteErrorBoundary /> },
          { path: "profile/:username", element: withSuspense(<ProfilePage />), errorElement: <RouteErrorBoundary /> },
          ...(moderationEnabled ? [{ path: ROUTES.admin.slice(1), element: withSuspense(<AdminPage />), errorElement: <RouteErrorBoundary /> }] : []),
        ],
      },
    ],
  },
]);
