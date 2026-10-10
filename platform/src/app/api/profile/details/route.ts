import { profileDetails } from '@/server/claims/profile-details';
import { withErrors } from '@/server/errors';
import { requireCandidate } from '@/server/session';

export const dynamic = 'force-dynamic';
export const GET = withErrors(async (req: Request) => Response.json(await profileDetails(requireCandidate(req))));
