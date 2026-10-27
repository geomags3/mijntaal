import { exportBackup, importBackup, previewBackup } from '../../../lib/server/backup';
import { AppError, fail, json, mutation, owner } from '../../../lib/server/common';
export async function GET(r: Request) {
  try {
    return json(await exportBackup(owner(r)));
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const user = owner(r);
    if (Number(r.headers.get('Content-Length') || 0) > 12000000)
      throw new AppError('Use a backup of up to 12 MB.', 413);
    if (!r.body) throw new AppError('Choose a backup file.');
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let source = '',
      bytes = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 12000000) {
        await reader.cancel();
        throw new AppError('Use a backup of up to 12 MB.', 413);
      }
      source += decoder.decode(next.value, { stream: true });
    }
    source += decoder.decode();
    let b;
    try {
      b = JSON.parse(source);
    } catch {
      throw new AppError('The backup file is not valid JSON.');
    }
    if (b.action === 'preview') return json(await previewBackup(user, b.backup));
    if (b.action === 'import') return json(await importBackup(user, b.backup, b.token));
    throw new AppError('Choose Preview or Import.');
  } catch (e) {
    return fail(e);
  }
}
