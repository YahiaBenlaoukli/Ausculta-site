import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';

/**
 * Keeps an assistant out of a doctor-only route.
 *
 * The sidebar already hides these entries, but hiding a link is not the same as
 * closing a door — the routes are hash URLs and survive a reload. This is still
 * only about what gets *offered*: the pages behind it would render empty
 * anyway, because every channel they call is refused in the main process.
 *
 * Renders nothing while the role is still loading rather than guessing, so a
 * doctor never sees their own settings page bounce them to the dashboard on a
 * slow first paint.
 */
export default function DoctorOnly({ children }: { children: React.ReactNode }) {
    const { user, loading, isDoctor } = useCurrentUser();

    if (loading) return null;
    if (!user) return <Navigate to="/" replace />;
    if (!isDoctor) return <Navigate to="/dashboard" replace />;

    return <>{children}</>;
}
