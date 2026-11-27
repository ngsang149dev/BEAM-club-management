import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { getContainer } from '@/server/shared/composition';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  let destination = '/login';

  if (token) {
    try {
      const auth = await getContainer().authService.authenticateSession(token);
      destination = auth.profile.mustChangePassword
        ? '/profile?changePassword=1'
        : '/tasks';
    } catch {
      destination = '/login';
    }
  }

  redirect(destination);
}
