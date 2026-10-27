import { fail, json, owner } from '../../../lib/server/common';
import { audioCacheScope, getSettings } from '../../../lib/server/settings';
export async function GET(r: Request) {
  try {
    const user = owner(r),
      s = await getSettings(user);
    return json({
      tts: s.keyConfigured,
      audioCacheScope: await audioCacheScope(user, s.preferences),
    });
  } catch (e) {
    return fail(e);
  }
}
