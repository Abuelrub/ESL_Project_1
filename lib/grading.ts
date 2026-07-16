import { gradeWrittenSentence } from "@/lib/ai";

export interface GradeResult {
  isCorrect: boolean;
  correctDisplay: string;
  answerText: string;
  feedback: string;
}

export async function gradeAnswer(
  questionType: string,
  data: Record<string, unknown>,
  answer: unknown,
  wordText: string
): Promise<GradeResult> {
  let isCorrect = false;
  let correctDisplay = "";
  let feedback = String(data.explanation ?? "");
  let answerText = "";

  switch (questionType) {
    case "multiple_choice":
    case "sentence_completion": {
      const idx = Number(answer);
      const options = data.options as string[];
      isCorrect = idx === Number(data.correct_index);
      correctDisplay = options[Number(data.correct_index)];
      answerText = options[idx] ?? String(answer);
      break;
    }
    case "true_false": {
      const val = answer === true || answer === "true";
      isCorrect = val === Boolean(data.correct_answer);
      correctDisplay = data.correct_answer ? "True" : "False";
      answerText = val ? "True" : "False";
      break;
    }
    case "fill_blank": {
      const chosen = String(answer).trim().toLowerCase();
      isCorrect = chosen === String(data.correct_word).trim().toLowerCase();
      correctDisplay = String(data.correct_word);
      answerText = String(answer);
      break;
    }
    case "multi_select": {
      const chosen = (Array.isArray(answer) ? answer : []).map(Number).sort();
      const correct = (data.correct_indices as number[]).map(Number).sort();
      isCorrect =
        chosen.length === correct.length && chosen.every((v, i) => v === correct[i]);
      const options = data.options as string[];
      correctDisplay = correct.map((i) => options[i]).join(" · ");
      answerText = chosen.map((i) => options[i] ?? i).join(" | ");
      break;
    }
    case "matching": {
      const chosen = (Array.isArray(answer) ? answer : []).map(Number);
      const defMap = (data.def_map as number[]) ?? [];
      const pairs = data.pairs as { word: string; definition: string }[];
      isCorrect =
        chosen.length === pairs.length &&
        chosen.every((defIdx, wordIdx) => defMap[defIdx] === wordIdx);
      correctDisplay = pairs.map((p) => `${p.word} = ${p.definition}`).join(" · ");
      const defs = data.shuffled_definitions as string[];
      answerText = chosen
        .map((defIdx, wordIdx) => `${pairs[wordIdx]?.word} -> ${defs?.[defIdx] ?? defIdx}`)
        .join(" | ");
      break;
    }
    case "write_sentence": {
      answerText = String(answer).trim();
      const graded = await gradeWrittenSentence(wordText, answerText);
      isCorrect = graded.is_correct;
      feedback = graded.feedback;
      correctDisplay = "";
      break;
    }
  }
  return { isCorrect, correctDisplay, answerText, feedback };
}
