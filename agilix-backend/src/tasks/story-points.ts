/**
 * The only story-point values AgiliX accepts (Fibonacci-style Agile scale).
 * Shared by the task DTOs (manual/applied values) and the AI estimator.
 */
export const STORY_POINT_SCALE = [0, 1, 2, 3, 5, 8, 13] as const;

export type StoryPointValue = (typeof STORY_POINT_SCALE)[number];

export function isStoryPointValue(value: unknown): value is StoryPointValue {
  return (STORY_POINT_SCALE as readonly unknown[]).includes(value);
}

export const STORY_POINT_SCALE_MESSAGE = `storyPoints must be one of ${STORY_POINT_SCALE.join(', ')}`;