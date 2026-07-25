// ============================================================
// ADAPTIVE DIFFICULTY ENGINE
// The CODE controls the strategy; the AI only writes the content.
// ============================================================

export type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "fill_blank"
  | "sentence_completion"
  | "multi_select"
  | "matching"
  | "write_sentence";

export interface WordCandidate {
  id: string;
  text: string;
  difficulty: "easy" | "hard";
  unit_id: string;
  isCurrentUnit: boolean;
  practice_count: number;
  current_level: number;
}

export const DEFAULT_QUIZ_QUESTIONS = 5;
export const MASTERY_COUNT = 8;

// Starting level: teacher-marked hard words start one level higher
export function startingLevel(difficulty: "easy" | "hard") {
  return difficulty === "hard" ? 2 : 1;
}

// STREAK RULE (within a session, across all words):
//   0 correct in a row -> base level
//   1 correct in a row -> a little harder (+1)
//   2 correct in a row -> harder (+2)
//   3+ correct in a row -> stays at the hard level (+2, capped)
//   a wrong answer resets the streak -> back to base
export function streakBonus(streak: number) {
  // Small bump only: +1 after 2+ correct in a row.
  // Reaching level 5 (write_sentence) requires the WORD\'s own base level to be 4+.
  return streak >= 2 ? 1 : 0;
}

export function effectiveLevel(baseLevel: number, streak: number) {
  return Math.min(5, Math.max(1, baseLevel + streakBonus(streak)));
}

// Which question types fit each level (picked randomly among them)
// Each level has a diverse pool; picked at random for variety
const TYPES_BY_LEVEL: Record<number, QuestionType[]> = {
  1: ["true_false", "multiple_choice", "true_false", "multiple_choice", "fill_blank"],
  2: ["multiple_choice", "true_false", "fill_blank", "sentence_completion", "true_false"],
  3: ["fill_blank", "sentence_completion", "matching", "true_false", "multiple_choice"],
  4: ["multi_select", "matching", "fill_blank", "sentence_completion", "true_false"],
  5: ["write_sentence", "multi_select", "matching", "fill_blank"], // still mixed
};

export function pickQuestionType(level: number): QuestionType {
  const pool = TYPES_BY_LEVEL[Math.min(5, Math.max(1, level))];
  return pool[Math.floor(Math.random() * pool.length)];
}

// Long-term per-word level: correct -> up (max 5), wrong -> down (min 1)
export function nextLevel(currentLevel: number, wasCorrect: boolean) {
  return Math.min(5, Math.max(1, currentLevel + (wasCorrect ? 1 : -1)));
}

// Fisher-Yates shuffle that also returns the permutation used
export function shuffleWithMap<T>(arr: T[]): { shuffled: T[]; newIndexOf: number[] } {
  const order = arr.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // order[k] = original index now sitting at position k
  const shuffled = order.map((oi) => arr[oi]);
  const newIndexOf: number[] = [];
  order.forEach((oi, k) => { newIndexOf[oi] = k; });
  return { shuffled, newIndexOf };
}

// Pick the next word:
// - 60% from the current unit, 40% review from earlier units
// - prefer words with fewer practices (below mastery first)
// - never repeat a word already used in this session
export function pickWord(
  candidates: WordCandidate[],
  usedWordIds: Set<string>
): WordCandidate | null {
  const fresh = candidates.filter((w) => !usedWordIds.has(w.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  if (pool.length === 0) return null;

  const current = pool.filter((w) => w.isCurrentUnit);
  const review = pool.filter((w) => !w.isCurrentUnit);

  let chosenPool: WordCandidate[];
  if (review.length === 0) chosenPool = current;
  else if (current.length === 0) chosenPool = review;
  else chosenPool = Math.random() < 0.6 ? current : review;

  const belowMastery = chosenPool.filter((w) => w.practice_count < MASTERY_COUNT);
  const target = belowMastery.length > 0 ? belowMastery : chosenPool;

  // HARD-WORD PRIORITY: hard words get ~70% of the attention, easy ~30%
  const hardWords = target.filter((w) => w.difficulty === "hard");
  const easyWords = target.filter((w) => w.difficulty === "easy");
  let finalPool = target;
  if (hardWords.length > 0 && easyWords.length > 0) {
    finalPool = Math.random() < 0.7 ? hardWords : easyWords;
  } else if (hardWords.length > 0) {
    finalPool = hardWords;
  } else if (easyWords.length > 0) {
    finalPool = easyWords;
  }

  const minCount = Math.min(...finalPool.map((w) => w.practice_count));
  const leastPracticed = finalPool.filter((w) => w.practice_count <= minCount + 1);

  return leastPracticed[Math.floor(Math.random() * leastPracticed.length)];
}
