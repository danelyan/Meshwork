import { assertSameOrigin } from '@/server/auth/csrf';
import { FavoriteInput, listFavorites, setFavorite } from '@/server/favorites';
import { withErrors } from '@/server/errors';
import { requireUser } from '@/server/session';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  const owner = requireUser(req);
  return Response.json(await listFavorites(owner));
});

export const PUT = withErrors(async (req: Request) => {
  assertSameOrigin(req);
  const owner = requireUser(req);
  const input = FavoriteInput.parse(await req.json().catch(() => ({})));
  return Response.json(await setFavorite(owner, input));
});
