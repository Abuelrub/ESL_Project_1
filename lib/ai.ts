// ============================================================
// AI QUESTION GENERATION — server-side only
// ============================================================
import Anthropic from "@anthropic-ai/sdk";
import type { QuestionType } from "@/lib/adaptive";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-5-20250929";

const LEVEL_GUIDE: Record<number, string> = {
  1: "Very simple. Obvious wrong answers. Very short sentences (max 8 words).",
  2: "Simple. Wrong answers are clearly different from the correct one.",
  3: "Medium. Use the word in a real-life sentence context.",
  4: "Challenging. Wrong answers are plausible and tricky. Test deep understanding.",
  5: "Mastery check. The student must produce their own sentence.",
};

const SCHEMAS: Record<QuestionType, string> = {
  multiple_choice: `{"question": "What does 'WORD' mean?", "options": ["opt1","opt2","opt3","opt4"], "correct_index": 0, "explanation": "short simple explanation"}`,
  true_false: `{"statement": "a statement using or about the word", "correct_answer": true, "explanation": "short simple explanation"}`,
  fill_blank: `{"sentence": "A sentence with ___ where the word goes.", "options": ["word1","word2","word3","word4"], "correct_word": "the correct word", "explanation": "short simple explanation"}`,
  sentence_completion: `{"question": "Complete: 'sentence start...'", "options": ["ending1","ending2","ending3","ending4"], "correct_index": 0, "explanation": "short simple explanation"}`,
  multi_select: `{"question": "Select ALL sentences that use 'WORD' correctly:", "options": ["sent1","sent2","sent3","sent4"], "correct_indices": [0,2], "explanation": "short simple explanation"}`,
  write_sentence: `{"instruction": "Write your own sentence using the word 'WORD'.", "hint": "a short hint about the word's meaning"}`,
  matching: `{"pairs": [{"word": "WORD", "definition": "short simple meaning"}, {"word": "other1", "definition": "short simple meaning"}, {"word": "other2", "definition": "short simple meaning"}], "explanation": "short simple explanation of 'WORD'"}`,
};

export interface GeneratedQuestion {
  [key: string]: unknown;
}

export async function generateQuestion(
  type: QuestionType,
  word: string,
  level: number,
  reviewNote: string,
  distractorWords: string[],
  desiredBool?: boolean,
  contextWords: string[] = [],
  useWordForms = false
): Promise<GeneratedQuestion> {
  let typeRule = "Make wrong answers believable but clearly incorrect.";
  if (type === "fill_blank" && useWordForms) {
    typeRule = `WORD FORMS CHALLENGE: All 4 options must be different grammatical forms of "${word}" (for example: base form, -er/-est, -ly adverb, noun form, -ing/-ed, plural — whichever exist for this word; for phrases use tense variations like "gave up", "giving up"). Exactly ONE form must fit the sentence grammatically and by meaning. Set "correct_word" to that fitting form (it does NOT need to be "${word}" itself). The other 3 forms must be real English forms that do NOT fit the sentence.`;
  } else if (type === "fill_blank") {
    typeRule = `The wrong options must come from this list of other vocabulary words: ${distractorWords.join(", ")}. Include "${word}" as the correct word.`;
  } else if (type === "true_false") {
    typeRule = `IMPORTANT: The statement must be ${desiredBool ? "TRUE" : "FALSE"}. Set "correct_answer" to ${desiredBool}.`;
  } else if (type === "matching") {
    typeRule = `Create exactly 3 pairs. The first pair must use "${word}". The other 2 words must come from this list: ${distractorWords.join(", ")}. Each definition must be short (max 8 words) and clearly different from the others.`;
  }

  const prompt = `You are creating ONE vocabulary practice question for a Novice 2 (beginner) adult ESL student.

TARGET WORD: "${word}"
QUESTION TYPE: ${type}
DIFFICULTY LEVEL: ${level} of 5 — ${LEVEL_GUIDE[level]}
${reviewNote}

RULES:
- Use simple, clear English suitable for beginners.
- Keep sentences short.
- ${typeRule}
- The explanation must be one short, encouraging sentence in simple English.
- Also include a "hint" field: one short clue in simple English that helps WITHOUT revealing the answer.
${contextWords.length > 0 ? `- REVIEW REINFORCEMENT: naturally use one or two of these words the student ALREADY LEARNED inside your sentences: ${contextWords.join(", ")}. They must appear in the sentence text only — NEVER as the correct answer.` : ""}

Respond with ONLY this JSON, no other text:
${SCHEMAS[type].replaceAll("WORD", word)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");

      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;

      const data = JSON.parse(match[0]) as GeneratedQuestion;
      if (validate(type, data)) return data;
    } catch {
      // retry once
    }
  }
  throw new Error("Could not generate a question");
}

function validate(type: QuestionType, d: GeneratedQuestion): boolean {
  switch (type) {
    case "multiple_choice":
    case "sentence_completion":
      return (
        typeof d.question === "string" &&
        Array.isArray(d.options) && d.options.length >= 3 &&
        typeof d.correct_index === "number" &&
        d.correct_index >= 0 && d.correct_index < (d.options as unknown[]).length
      );
    case "true_false":
      return typeof d.statement === "string" && typeof d.correct_answer === "boolean";
    case "matching": {
      const pairs = d.pairs as { word?: unknown; definition?: unknown }[] | undefined;
      return (
        Array.isArray(pairs) && pairs.length >= 2 &&
        pairs.every((p) => typeof p.word === "string" && typeof p.definition === "string")
      );
    }
    case "fill_blank":
      return (
        typeof d.sentence === "string" && (d.sentence as string).includes("___") &&
        Array.isArray(d.options) && typeof d.correct_word === "string" &&
        (d.options as string[]).includes(d.correct_word as string)
      );
    case "multi_select":
      return (
        typeof d.question === "string" && Array.isArray(d.options) &&
        Array.isArray(d.correct_indices) && (d.correct_indices as unknown[]).length >= 1
      );
    case "write_sentence":
      return typeof d.instruction === "string";
  }
}

// Grade a level-5 written sentence
export async function gradeWrittenSentence(
  word: string,
  sentence: string
): Promise<{ is_correct: boolean; feedback: string }> {
  const prompt = `A Novice 2 (beginner) ESL student was asked to write a sentence using the word "${word}".

Their sentence: "${sentence}"

Judge kindly:
- is_correct = true if the sentence uses "${word}" with roughly the right meaning. Ignore small grammar and spelling mistakes.
- is_correct = false only if the word is missing or used with the wrong meaning.
- feedback: ONE short, warm sentence in very simple English. If wrong, gently show a correct example.

Respond with ONLY this JSON:
{"is_correct": true, "feedback": "..."}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      if (typeof data.is_correct === "boolean" && typeof data.feedback === "string") {
        return data;
      }
    }
  } catch {
    // fall through
  }
  return {
    is_correct: sentence.toLowerCase().includes(word.toLowerCase()),
    feedback: `Good try! Keep practicing with "${word}".`,
  };
}

// ============================================================
// LESSON CONTENT — the "teach first" part of practice mode
// ============================================================
export interface LessonContent {
  definition: string;
  part_of_speech: string;
  example: string;
  examples_in_action: string[];
  hint: string;
}

export async function generateLessonContent(word: string): Promise<LessonContent> {
  const prompt = `You are teaching the English word "${word}" to a Novice 2 (beginner) adult ESL student.

Respond with ONLY this JSON, no other text:
{"definition": "very simple meaning, max 10 words", "part_of_speech": "noun/verb/adjective/phrase", "example": "one very clear short sentence using the word", "examples_in_action": ["sentence from daily life", "sentence about work or study", "sentence about family or friends"], "hint": "a short memory tip that does NOT reveal the definition directly"}

Rules: simple clear English, short sentences (max 10 words each), each example from a different real-life situation, and every example must contain the word "${word}".`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const d = JSON.parse(match[0]);
      if (
        typeof d.definition === "string" &&
        typeof d.example === "string" &&
        Array.isArray(d.examples_in_action)
      ) {
        return {
          definition: d.definition,
          part_of_speech: String(d.part_of_speech ?? ""),
          example: d.example,
          examples_in_action: (d.examples_in_action as string[]).slice(0, 3),
          hint: String(d.hint ?? ""),
        };
      }
    } catch {
      // retry once
    }
  }
  throw new Error("Could not generate lesson content");
}

// Generate a lesson check question WITH a hint field
export async function generateLessonQuestion(
  type: QuestionType,
  word: string,
  level: number,
  distractorWords: string[],
  desiredBool?: boolean,
  contextWords: string[] = [],
  useWordForms = false
): Promise<GeneratedQuestion> {
  const q = await generateQuestion(
    type, word, level,
    "This is PRACTICE mode: the student is still learning this word. Be encouraging.",
    distractorWords, desiredBool, contextWords, useWordForms
  );
  if (!q.hint) {
    // Ask for a hint in a tiny follow-up only if missing
    q.hint = `Think about what "${word}" means in daily life.`;
  }
  return q;
}
