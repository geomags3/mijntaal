import { AppError, body, fail, owner } from '../../lib/server/common';
import { z } from 'zod';
import { deleteLessonSchema, saveLessonSchema, saveProgramSchema } from '../../lib/lessons';
import {
  getLesson,
  deleteLesson,
  getProgram,
  listLessons,
  listPrograms,
  saveLesson,
  saveProgram,
} from '../../lib/server/lessons';
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
    name: 'delete_lesson',
    description:
      'Permanently delete one owned lesson, all its saved progress and run history. This is irreversible and does not move it to Archive. Only use after the user explicitly requests permanent deletion of that lesson. Read get_lesson first, then pass its id, version and progress revision plus confirm=true. On conflict reload and obtain confirmation again. Other lessons, programs and collection materials remain unchanged.',
    inputSchema: z.toJSONSchema(deleteLessonSchema, { io: 'input' }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'list_programs',
    description:
      'List the caller’s Dutch learning programs and ordered topics. Archived programs are requested explicitly.',
    inputSchema: object({ archived: { type: 'boolean' } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_program',
    description: 'Read a learning program and its version before editing.',
    inputSchema: object({ id: { type: 'string' } }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'save_program',
    description:
      'Create or update a Dutch curriculum with ordered topics. Omit id/version to create; read first and supply both to replace content. Keep topic IDs stable and unique. Referenced topics cannot be removed. Archive with archived=true; no learning progress is deleted. Save lessons separately using save_lesson.',
    inputSchema: z.toJSONSchema(saveProgramSchema, { io: 'input' }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'list_lessons',
    description:
      'List lesson summaries, order and saved completion progress. Filter by programId or explicitly request archived lessons.',
    inputSchema: object({ programId: { type: 'string' }, archived: { type: 'boolean' } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_lesson',
    description:
      'Read complete lesson content, current authoring version and saved run. A run retains its original content version after edits. Never mark progress complete through authoring.',
    inputSchema: object({ id: { type: 'string' } }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'save_lesson',
    description:
      'Create or update a compact Dutch lesson, standalone or in an existing program/topic. Omit id/version to create; to update, read first and send both plus complete content and associations. Use stable unique block IDs. Alternate brief explanations/examples and exercises; English is the translation reference. Every exercise needs feedback explanation. Descriptive strings accept **bold**, *italic* and `inline code`; explanation text also supports paragraphs, flat lists, # headings and > quotes. Keep answer/answers/options/tokens/matching labels and gap sentence plain text; HTML and links stay literal. Choice: four distinct options, correct is zero-based. Letters/words: tokens must reconstruct answers[0] exactly, including repeated letters/words and spaces. Match: unique left and right labels. Gap: exactly one ___ in sentence, accepted answers, optional distinct options including answers[0]. Table rows match 2–3 columns; diagram is vertical steps; images require HTTPS URL and alt text. Keep lesson content under 70,000 characters. Edits preserve existing runs; archived=true hides the lesson without deleting progress. No provider API calls or answer submissions occur.',
    inputSchema: z.toJSONSchema(saveLessonSchema, { io: 'input' }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
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
        if (q.params.name === 'delete_lesson') out = await deleteLesson(user, a);
        else if (q.params.name === 'list_programs')
          out = await listPrograms(user, a.archived === true);
        else if (q.params.name === 'get_program') out = await getProgram(user, a.id);
        else if (q.params.name === 'save_program') out = await saveProgram(user, a);
        else if (q.params.name === 'list_lessons')
          out = await listLessons(user, a.programId, a.archived === true);
        else if (q.params.name === 'get_lesson') out = await getLesson(user, a.id);
        else if (q.params.name === 'save_lesson') out = await saveLesson(user, a);
        else if (q.params.name === 'list_materials')
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
