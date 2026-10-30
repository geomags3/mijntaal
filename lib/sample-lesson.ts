import payload from '../docs/examples/lesson-a1-city.json';
import {
  applyLessonAction,
  lessonActionSchema,
  lessonContentSchema,
  type LessonAction,
  type LessonProgress,
  type LessonRecord,
} from './lessons';

const sampleId = 'sample-lesson';
const content = lessonContentSchema.parse({
  ...payload.content,
  title: 'Getting around town · Sample lesson',
});

/** Unsaved demonstration, deliberately separate from owned lesson IDs and APIs. */
export function createSampleLesson(): LessonRecord {
  return {
    id: sampleId,
    version: 1,
    archived: false,
    programId: null,
    topicId: null,
    order: 0,
    content: structuredClone(content),
    progress: null,
    revision: 0,
  };
}

export function advanceSampleLesson(lesson: LessonRecord, input: LessonAction): LessonRecord {
  const a = lessonActionSchema.parse(input);
  if (lesson.id !== sampleId || a.lessonId !== sampleId)
    throw Error('This is not a sample lesson.');
  const previous = lesson.progress;
  if (previous?.eventIds.includes(a.eventId)) return lesson;
  if (a.revision !== lesson.revision) throw Error('The sample has changed. Try again.');
  let progress: LessonProgress;
  if (['start', 'restart', 'retry'].includes(a.action)) {
    if (previous && !previous.completed && a.action !== 'restart')
      throw Error('Continue the sample first.');
    if (a.action === 'restart' && !previous) throw Error('Start the sample first.');
    if (a.action === 'retry' && !previous?.completed) throw Error('Finish the sample first.');
    let nextContent = structuredClone(content);
    if (a.action === 'retry') {
      const missed = new Set(
        previous!.results.filter((r) => !r.correct || r.helped).map((r) => r.blockId),
      );
      nextContent = {
        ...previous!.content,
        blocks: previous!.content.blocks.filter((b) => missed.has(b.id)),
      };
      if (!nextContent.blocks.length) throw Error('No mistakes or hinted answers to repeat.');
    }
    progress = {
      runId: crypto.randomUUID(),
      lessonVersion: 1,
      content: nextContent,
      index: 0,
      results: [],
      hinted: false,
      revealed: false,
      feedback: null,
      eventIds: [a.eventId],
      completed: false,
    };
  } else {
    if (!previous) throw Error('Start the sample first.');
    progress = applyLessonAction(previous, a);
  }
  return { ...lesson, progress, revision: lesson.revision + 1 };
}
