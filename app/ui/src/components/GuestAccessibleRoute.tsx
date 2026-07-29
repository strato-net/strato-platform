import { ReactNode } from "react";

interface GuestAccessibleRouteProps {
  children: ReactNode;
}

/**
 * A route wrapper that allows both authenticated and unauthenticated users to access the page.
 * Unlike ProtectedRoute, this does not redirect to login.
 * Components wrapped by this route should handle their own guest vs authenticated UI.
 */
const GuestAccessibleRoute = ({ children }: GuestAccessibleRouteProps) => {
  // Simply render children - no authentication check needed
  // The wrapped component is responsible for handling guest mode UI
  return <>{children}</>;
};

export default GuestAccessibleRoute;
