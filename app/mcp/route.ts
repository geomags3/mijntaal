import { AppError, body, fail, owner } from '../../lib/server/common';
import {
  addMaterial,
  getMaterial,
  listMaterials,
  updateMaterial,
} from '../../lib/server/materials';
const object = (properties: any, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const tools = [
  {
    name: 'list_materials',
    description:
      'List and search the user’s Dutch words, phrases, notes and texts. Includes IDs, versions and practice ranks.',
    inputSchema: object({ query: { type: 'string' }, archived: { type: 'boolean' } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_material',
    description: 'Read one material by ID.',
    inputSchema: object({ id: { type: 'string' } }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_material',
    description:
      'Save a Dutch phrase, note or text. Phrase body: {en,example,exampleTranslation,original,notes,source}. Text body: {source,segments:[{nl,en}]}. Set practiceMode to words, sentences or off. Legacy practice=true selects Words. Sentences practises the whole phrase with word blocks or typing. An English meaning is required. Existing exact entries are not duplicated.',
    inputSchema: object(
      {
        kind: { type: 'string', enum: ['phrase', 'note', 'text'] },
        title: { type: 'string' },
        body: { type: 'object', additionalProperties: true },
        practice: { type: 'boolean' },
        practiceMode: { type: 'string', enum: ['words', 'sentences', 'off'] },
      },
      ['kind', 'title', 'body'],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'update_material',
    description:
      'Update an existing material with optimistic version checking. Set archived=true to archive, false to restore; practice toggles practice. Set practiceMode to words, sentences or off to choose a training mode. Never overwrite user edits without checking the version.',
    inputSchema: object(
      {
        id: { type: 'string' },
        version: { type: 'integer' },
        title: { type: 'string' },
        body: { type: 'object', additionalProperties: true },
        archived: { type: 'boolean' },
        practice: { type: 'boolean' },
        practiceMode: { type: 'string', enum: ['words', 'sentences', 'off'] },
      },
      ['id', 'version'],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];
export async function POST(r: Request) {
  let q: any;
  try {
    const user = owner(r);
    q = await body(r);
    let result: any;
    if (q.method === 'server/discover')
      result = { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } };
    else if (q.method === 'initialize')
      result = {
        protocolVersion: '2026-07-28',
        capabilities: { tools: {} },
        serverInfo: { name: 'mijntaal', version: '0.2.0' },
      };
    else if (q.method === 'tools/list') result = { tools };
    else if (q.method === 'tools/call') {
      try {
        const a = q.params.arguments || {};
        let out;
        if (q.params.name === 'list_materials')
          out = await listMaterials(user, a.query || '', a.archived === true);
        else if (q.params.name === 'get_material') {
          out = await getMaterial(user, a.id);
        } else if (q.params.name === 'add_material') out = await addMaterial(user, a);
        else if (q.params.name === 'update_material') out = await updateMaterial(user, a);
        else throw new AppError('Unknown tool');
        result = { content: [{ type: 'text', text: JSON.stringify(out) }] };
      } catch (e) {
        result = {
          isError: true,
          content: [
            {
              type: 'text',
              text: e instanceof AppError ? e.message : 'Could not complete this operation.',
            },
          ],
        };
      }
    } else if (q.method?.startsWith('notifications/')) return new Response(null, { status: 204 });
    else
      return Response.json({
        jsonrpc: '2.0',
        id: q.id,
        error: { code: -32601, message: 'Method not found' },
      });
    return Response.json({ jsonrpc: '2.0', id: q.id, result });
  } catch (e) {
    return fail(e);
  }
}
