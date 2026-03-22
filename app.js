const pastPapersInput = document.getElementById("past-papers");
const examForm = document.getElementById("exam-form");
const examOutput = document.getElementById("exam-output");
const fileInput = document.getElementById("paper-files");
const copyButton = document.getElementById("copy-exam");
const clearButton = document.getElementById("clear-exam");
const loadSampleButton = document.getElementById("load-sample");

const COMMAND_TERMS = [
  "Define",
  "Explain",
  "Describe",
  "Outline",
  "Analyse",
  "Compare",
  "Evaluate",
  "Discuss",
  "To what extent",
];

const MIN_QUESTION_COUNT = 4;
const MAX_QUESTION_COUNT = 20;
const MAX_SENTENCE_LENGTH = 150;
const PAST_PAPER_PLACEHOLDER =
  "Paste past paper excerpts here… (separate papers with a blank line)";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "their",
  "which",
  "about",
  "using",
  "such",
  "have",
  "has",
  "were",
  "was",
  "are",
  "is",
  "will",
  "shall",
  "could",
  "would",
  "should",
  "over",
  "under",
  "between",
  "within",
  "when",
  "where",
  "while",
  "there",
  "these",
  "those",
  "they",
  "them",
  "also",
  "only",
  "than",
  "then",
  "been",
  "being",
  "past",
  "paper",
  "papers",
  "section",
  "question",
]);

const SAMPLE_TEXT = `Paper 1 - Section A
1. Define the term homeostasis.
2. Describe two ways enzymes control reaction rates.

Paper 1 - Section B
3. Explain how fiscal policy can influence aggregate demand.
4. Outline the steps of the scientific method in environmental systems.

Paper 2 - Section A
5. Analyse the impact of urbanisation on biodiversity.
6. Compare two approaches to ethical decision-making in business management.

Paper 2 - Section B
7. Evaluate the reliability of the data presented in the case study.
8. Discuss the role of language in shaping cultural identity.`;

const PLACEHOLDER_OUTPUT =
  "Your generated IB-style practice exam will appear here.";

const cleanText = (text) => text.replace(/\s+/g, " ").trim();

const splitIntoSentences = (text) => {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return [];
  }
  const matches = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return matches
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40);
};

const tokenize = (text) =>
  (text.toLowerCase().match(/[a-z][a-z']+/g) || []).filter(
    (word) => !STOP_WORDS.has(word) && word.length > 3,
  );

const buildFrequencyMap = (tokens) =>
  tokens.reduce((map, token) => {
    map[token] = (map[token] || 0) + 1;
    return map;
  }, {});

const hashString = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
};

const mulberry32 = (seed) => {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pickRandom = (items, rng) => items[Math.floor(rng() * items.length)];

const pickKeywords = (sentence, frequencyMap) => {
  const words = tokenize(sentence);
  const uniqueWords = [...new Set(words)];
  if (uniqueWords.length > 0) {
    return uniqueWords.slice(0, 2);
  }
  const fallback = Object.entries(frequencyMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([word]) => word);
  return fallback.length ? fallback : ["the topic"];
};

const clipSentence = (sentence, maxLength = MAX_SENTENCE_LENGTH) => {
  if (sentence.length <= maxLength) {
    return sentence;
  }
  const clipped = sentence.slice(0, maxLength).trim();
  return `${clipped}…`;
};

const buildPrompt = ({ term, focus, comparison, subject, extract }) => {
  switch (term) {
    case "Define":
      return `Define ${focus} as used in the extract.`;
    case "Explain":
      return `Explain why ${focus} matters in ${subject}.`;
    case "Describe":
      return `Describe ${focus} with reference to the extract.`;
    case "Outline":
      return `Outline two key points about ${focus}.`;
    case "Analyse":
      return `Analyse the extract, focusing on ${focus}.`;
    case "Compare":
      return `Compare ${focus} with ${comparison} in relation to ${subject}.`;
    case "Evaluate":
      return `Evaluate the claim made in the extract about ${focus}.`;
    case "Discuss":
      return `Discuss how ${focus} influences outcomes in ${subject}.`;
    case "To what extent":
      return `To what extent does ${focus} apply to the scenario in the extract?`;
    default:
      return `Explain ${focus} using evidence from the extract.`;
  }
};

const createQuestion = ({
  index,
  sentence,
  subject,
  term,
  marksRange,
  frequencyMap,
  rng,
}) => {
  const keywords = pickKeywords(sentence, frequencyMap);
  const focus = keywords[0] || "the concept";
  const comparison = keywords[1] || "a contrasting idea";
  const marks = pickRandom(marksRange, rng);
  const prompt = buildPrompt({
    term,
    focus,
    comparison,
    subject,
    extract: sentence,
  });
  return `${index}. [${marks} marks] ${prompt}\n   Source extract: ${clipSentence(
    sentence,
  )}`;
};

const generateExam = ({ subject, level, duration, questionCount, rawText }) => {
  const sentences = splitIntoSentences(rawText);
  if (sentences.length === 0) {
    return {
      success: false,
      message:
        "Please paste at least a few sentences from past papers so the generator can build IB-style questions.",
    };
  }

  const frequencyMap = buildFrequencyMap(tokenize(rawText));
  const seed = hashString(`${subject}-${level}-${rawText.length}`);
  const rng = mulberry32(seed);
  const questions = [];
  const usedIndices = new Set();
  const safeQuestionCount = Math.min(
    Math.max(questionCount, MIN_QUESTION_COUNT),
    MAX_QUESTION_COUNT,
  );
  const paperOneCount = Math.min(
    safeQuestionCount,
    Math.max(MIN_QUESTION_COUNT, Math.round(safeQuestionCount * 0.6)),
  );
  const paperTwoCount = Math.max(0, safeQuestionCount - paperOneCount);

  for (let i = 0; i < safeQuestionCount; i += 1) {
    let attempts = 0;
    let sentenceIndex = Math.floor(rng() * sentences.length);
    while (usedIndices.has(sentenceIndex) && attempts < sentences.length) {
      sentenceIndex = Math.floor(rng() * sentences.length);
      attempts += 1;
    }
    usedIndices.add(sentenceIndex);
    questions.push(sentences[sentenceIndex]);
  }

  const commandTermMix = Array.from({ length: safeQuestionCount }, () =>
    pickRandom(COMMAND_TERMS, rng),
  );
  const commandTermSummary = [...new Set(commandTermMix)]
    .slice(0, 6)
    .join(", ");

  const examLines = [];
  examLines.push("IB Practice Exam (Draft)");
  examLines.push(`Subject: ${subject}`);
  examLines.push(`Level: ${level}`);
  examLines.push(`Time allowed: ${duration} minutes`);
  examLines.push(`Generated from ${sentences.length} example sentences`);
  examLines.push(`Command terms: ${commandTermSummary}`);

  const addSection = (title, startIndex, count, marksRange) => {
    if (count <= 0) {
      return;
    }
    examLines.push("");
    examLines.push(title);
    examLines.push("Answer all questions.");
    for (let i = 0; i < count; i += 1) {
      const questionIndex = startIndex + i + 1;
      const term =
        commandTermMix[questionIndex - 1] || pickRandom(COMMAND_TERMS, rng);
      const sentence = questions[questionIndex - 1] || questions[0];
      examLines.push(
        createQuestion({
          index: questionIndex,
          sentence,
          subject,
          term,
          marksRange,
          frequencyMap,
          rng,
        }),
      );
    }
  };

  addSection("Paper 1 — Short-answer", 0, paperOneCount, [2, 4, 6]);
  addSection(
    "Paper 2 — Structured response",
    paperOneCount,
    paperTwoCount,
    [8, 10, 12],
  );

  examLines.push("");
  examLines.push("Examiner tips:");
  examLines.push(
    "- Use IB command terms and reference evidence from the extracts provided.",
  );
  examLines.push("- Allocate time based on mark values.");

  return { success: true, message: examLines.join("\n") };
};

const setOutput = (message) => {
  examOutput.textContent = message;
};

const appendFilesToTextarea = async (files) => {
  const contents = await Promise.all(
    files.map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve("");
          reader.readAsText(file);
        }),
    ),
  );
  const cleanedContents = contents.filter(Boolean).join("\n\n---\n\n");
  pastPapersInput.value = [pastPapersInput.value, cleanedContents]
    .filter(Boolean)
    .join("\n\n---\n\n");
};

fileInput.addEventListener("change", (event) => {
  const files = [...event.target.files];
  if (files.length === 0) {
    return;
  }
  appendFilesToTextarea(files);
});

loadSampleButton.addEventListener("click", () => {
  pastPapersInput.value = SAMPLE_TEXT;
});

examForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const subject = document.getElementById("subject").value.trim();
  const level = document.getElementById("level").value;
  const durationValue = Number(
    document.getElementById("duration").value || 90,
  );
  const questionCountValue = Number(
    document.getElementById("question-count").value || 10,
  );

  const result = generateExam({
    subject: subject || "your subject",
    level,
    duration: Number.isNaN(durationValue) ? 90 : durationValue,
    questionCount: Number.isNaN(questionCountValue) ? 10 : questionCountValue,
    rawText: pastPapersInput.value,
  });

  if (!result.success) {
    setOutput(result.message);
    return;
  }

  setOutput(result.message);
});

const copyToClipboardFallback = (text) => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  return success;
};

const showCopySuccess = () => {
  copyButton.textContent = "Copied!";
  setTimeout(() => {
    copyButton.textContent = "Copy exam";
  }, 1500);
};

copyButton.addEventListener("click", () => {
  const text = examOutput.textContent.trim();
  if (!text || text === PLACEHOLDER_OUTPUT) {
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(showCopySuccess).catch(() => {
      const success = copyToClipboardFallback(text);
      if (success) {
        showCopySuccess();
      }
    });
  } else {
    const success = copyToClipboardFallback(text);
    if (success) {
      showCopySuccess();
    }
  }
});

clearButton.addEventListener("click", () => {
  pastPapersInput.value = "";
  setOutput(PLACEHOLDER_OUTPUT);
});

pastPapersInput.setAttribute("placeholder", PAST_PAPER_PLACEHOLDER);
setOutput(PLACEHOLDER_OUTPUT);
