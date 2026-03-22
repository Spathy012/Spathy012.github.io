/* ─── ib-shafted.me · app.js ────────────────────────────────
   Uses the Anthropic Messages API (claude-sonnet-4-20250514)
   to generate IB-style practice exams with markschemes.
   API key is stored in sessionStorage only.
──────────────────────────────────────────────────────────── */

'use strict';

// ── State ──────────────────────────────────────────────────
let uploadedFiles = []; // { name, content }
let apiKey = sessionStorage.getItem('ib_api_key') || '';

// ── DOM refs ───────────────────────────────────────────────
const apiNotice        = document.getElementById('apiNotice');
const apiKeyRow        = document.getElementById('apiKeyRow');
const apiKeyInput      = document.getElementById('apiKey');
const showKeyInputBtn  = document.getElementById('showKeyInput');
const saveKeyBtn       = document.getElementById('saveKey');
const closeNoticeBtn   = document.getElementById('closeNotice');

const uploadZone       = document.getElementById('uploadZone');
const fileInput        = document.getElementById('fileInput');
const fileList         = document.getElementById('fileList');
const pasteArea        = document.getElementById('pasteArea');
const loadSampleBtn    = document.getElementById('loadSample');
const clearAllBtn      = document.getElementById('clearAll');

const subjectSel       = document.getElementById('subject');
const levelSel         = document.getElementById('level');
const paperSel         = document.getElementById('paper');
const qCountInput      = document.getElementById('questionCount');
const durationInput    = document.getElementById('duration');
const difficultySel    = document.getElementById('difficulty');
const includeMS        = document.getElementById('includeMarkscheme');
const includeCT        = document.getElementById('includeCommandTerms');

const generateBtn      = document.getElementById('generateBtn');
const generateLabel    = document.getElementById('generateLabel');
const generateIcon     = document.getElementById('generateIcon');

const outputWrap       = document.getElementById('outputWrap');
const placeholder      = document.getElementById('placeholder');
const outputEl         = document.getElementById('output');
const streamCursor     = document.getElementById('streamCursor');
const outputActions    = document.getElementById('outputActions');
const copyBtn          = document.getElementById('copyBtn');
const printBtn         = document.getElementById('printBtn');
const clearOutputBtn   = document.getElementById('clearOutput');

// ── API key flow ───────────────────────────────────────────
if (apiKey) hideApiNotice();

showKeyInputBtn?.addEventListener('click', () => {
  apiKeyRow.style.display = 'flex';
  apiKeyInput.focus();
});

saveKeyBtn?.addEventListener('click', () => {
  const k = apiKeyInput.value.trim();
  if (!k.startsWith('sk-ant-')) {
    alert('That doesn\'t look like a valid Anthropic key (should start with sk-ant-)');
    return;
  }
  apiKey = k;
  sessionStorage.setItem('ib_api_key', k);
  apiKeyInput.value = '';
  apiKeyRow.style.display = 'none';
  hideApiNotice();
});

closeNoticeBtn?.addEventListener('click', hideApiNotice);

function hideApiNotice() {
  if (apiNotice) apiNotice.style.display = 'none';
}

// ── File upload ────────────────────────────────────────────
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => handleFiles(fileInput.files));

function handleFiles(files) {
  [...files].forEach(f => {
    if (!f.name.endsWith('.txt')) return;
    const reader = new FileReader();
    reader.onload = e => {
      uploadedFiles.push({ name: f.name, content: e.target.result });
      renderFileChips();
    };
    reader.readAsText(f);
  });
  fileInput.value = '';
}

function renderFileChips() {
  fileList.innerHTML = '';
  uploadedFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `<span>📄 ${escHtml(f.name)}</span><button aria-label="Remove ${escHtml(f.name)}" data-idx="${i}">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      uploadedFiles.splice(i, 1);
      renderFileChips();
    });
    fileList.appendChild(chip);
  });
}

// ── Sample material ────────────────────────────────────────
loadSampleBtn.addEventListener('click', () => {
  pasteArea.value = SAMPLE_TEXT;
});

clearAllBtn.addEventListener('click', () => {
  pasteArea.value = '';
  uploadedFiles = [];
  renderFileChips();
});

// ── Steppers ───────────────────────────────────────────────
document.getElementById('decQ').addEventListener('click', () => stepInput(qCountInput, -1));
document.getElementById('incQ').addEventListener('click', () => stepInput(qCountInput,  1));
document.getElementById('decD').addEventListener('click', () => stepInput(durationInput, -5));
document.getElementById('incD').addEventListener('click', () => stepInput(durationInput,  5));

function stepInput(el, delta) {
  const v = parseFloat(el.value) + delta;
  const min = parseFloat(el.min);
  const max = parseFloat(el.max);
  if (!isNaN(min) && v < min) return;
  if (!isNaN(max) && v > max) return;
  el.value = v;
}

// ── Generate ───────────────────────────────────────────────
generateBtn.addEventListener('click', runGenerate);

async function runGenerate() {
  if (!apiKey) {
    apiKeyRow.style.display = 'flex';
    apiNotice.style.display = 'flex';
    apiKeyInput.focus();
    return;
  }

  const subject    = subjectSel.value;
  const level      = levelSel.value;
  const paper      = paperSel.value;
  const qCount     = parseInt(qCountInput.value) || 5;
  const duration   = parseInt(durationInput.value) || 60;
  const difficulty = difficultySel.value;
  const withMS     = includeMS.checked;
  const withCT     = includeCT.checked;

  // Collect source material
  const pasteParts = pasteArea.value.trim();
  const fileParts  = uploadedFiles.map(f => `[File: ${f.name}]\n${f.content}`).join('\n\n---\n\n');
  const sourceMaterial = [pasteParts, fileParts].filter(Boolean).join('\n\n---\n\n').trim();

  setGenerating(true);
  showOutput('');

  try {
    await streamExam({ subject, level, paper, qCount, duration, difficulty, withMS, withCT, sourceMaterial });
  } catch (err) {
    console.error(err);
    appendOutput(`\n\n⚠ Error: ${err.message}`);
  } finally {
    setGenerating(false);
    outputActions.style.display = 'flex';
    streamCursor.hidden = true;
  }
}

// ── Claude API (streaming) ─────────────────────────────────
async function streamExam({ subject, level, paper, qCount, duration, difficulty, withMS, withCT, sourceMaterial }) {
  const prompt = buildPrompt({ subject, level, paper, qCount, duration, difficulty, withMS, withCT, sourceMaterial });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'output-128k-2025-02-19',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }));
    const msg = err?.error?.message || resp.statusText;
    if (resp.status === 401) throw new Error('Invalid API key. Please re-enter your Anthropic key.');
    throw new Error(msg);
  }

  // Read SSE stream
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const evt = JSON.parse(raw);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          appendOutput(evt.delta.text);
        }
      } catch { /* skip malformed */ }
    }
  }
}

// ── Prompt construction ────────────────────────────────────
function buildPrompt({ subject, level, paper, qCount, duration, difficulty, withMS, withCT, sourceMaterial }) {
  const difficultyNote = {
    easier:  'Aim for slightly below the toughest exam questions — accessible but still rigorous.',
    harder:  'Aim for the hardest end of real IB exams — multi-step, demanding, discriminating.',
    mixed:   'Include a range of difficulty: some accessible opening questions and some challenging final questions.',
  }[difficulty] || '';

  const msNote = withMS
    ? 'After ALL questions, include a complete, detailed markscheme section with award points, acceptable answers, and indicative content as per IBO conventions.'
    : 'Do NOT include a markscheme.';

  const ctNote = withCT
    ? 'Annotate each question with the IB command term used (e.g., [Command term: Evaluate]) in brackets after the question text.'
    : '';

  const sourceSection = sourceMaterial
    ? `\n\nPAST PAPER MATERIAL (use this to calibrate style, vocabulary, and difficulty):\n\`\`\`\n${sourceMaterial.slice(0, 12000)}\n\`\`\``
    : '\n\n(No past paper material provided — generate based on general IB curriculum knowledge for this subject.)';

  return `Generate a ${subject} ${level} ${paper} practice exam.

Specifications:
- Subject: ${subject} (${level})
- Paper: ${paper}
- Number of questions: ${qCount}
- Total marks: approximately ${Math.round(qCount * duration / qCount * 0.8)} marks spread across questions
- Target duration: ${duration} minutes
- Difficulty: ${difficultyNote}

Formatting rules:
- Number questions clearly (1, 2, 3…)
- Include part letters for multi-part questions (a, b, c…)
- Show marks in square brackets: [2]
- Group questions thematically where appropriate
- Use correct IB notation for the subject (e.g., units, significant figures, stimulus materials)
${ctNote}

Markscheme:
${msNote}
${sourceSection}`;
}

const SYSTEM_PROMPT = `You are an expert IB examiner with 15+ years of experience writing official International Baccalaureate exam papers across all subjects. You have deep knowledge of:
- IB command terms and their precise meanings (define, explain, evaluate, discuss, analyse, etc.)
- Mark allocation conventions and how marks map to expected response length/depth
- The Assessment Objectives and how questions are designed to test them
- Common student misconceptions and how to write discriminating questions
- How to write markschemes that distinguish levels of understanding

When generating exams:
1. Match the exact register and style of official IB papers
2. Use subject-specific vocabulary precisely
3. Ensure mark allocations are realistic and internally consistent
4. Include all required stimulus material (graphs, data, quotes, sources) described clearly in [brackets]
5. For markschemes: use IB conventions — award marks with bullets, note "any two of the following", "max 2 marks", indicative content, etc.
6. Never include answers in the question section
7. Format cleanly with clear question numbering`;

// ── Output helpers ─────────────────────────────────────────
function showOutput(initial) {
  placeholder.style.display = 'none';
  outputEl.hidden = false;
  outputEl.textContent = initial;
  streamCursor.hidden = false;
  outputEl.after(streamCursor); // ensure cursor is after output
}

function appendOutput(chunk) {
  outputEl.textContent += chunk;
  // Auto-scroll
  outputWrap.scrollTop = outputWrap.scrollHeight;
}

function setGenerating(active) {
  generateBtn.disabled = active;
  if (active) {
    generateLabel.textContent = 'Generating…';
    generateIcon.textContent = '◌';
    generateIcon.classList.add('spin');
  } else {
    generateLabel.textContent = 'Generate Exam';
    generateIcon.textContent = '→';
    generateIcon.classList.remove('spin');
  }
}

// ── Copy / Print / Clear ───────────────────────────────────
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(outputEl.textContent);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
  } catch {
    // Fallback
    const r = document.createRange();
    r.selectNode(outputEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
    document.execCommand('copy');
    window.getSelection().removeAllRanges();
  }
});

printBtn.addEventListener('click', () => window.print());

clearOutputBtn.addEventListener('click', () => {
  outputEl.textContent = '';
  outputEl.hidden = true;
  placeholder.style.display = '';
  outputActions.style.display = 'none';
  streamCursor.hidden = true;
});

// ── Utility ────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Sample IB text ─────────────────────────────────────────
const SAMPLE_TEXT = `IB Biology HL Paper 2 — Sample Question

1. The diagram below shows a section of a cell membrane. [diagram described]

(a) Identify the molecule labelled X in the diagram. [1]

(b) Explain how the fluid mosaic model describes the structure of cell membranes. [3]

(c) Compare the process of active transport with facilitated diffusion. [4]

MARKSCHEME

1. (a) Award [1] for: phospholipid / glycolipid / cholesterol (depending on position)

(b) Award [3 max]:
• Phospholipids form a bilayer with hydrophobic tails facing inward;
• Proteins are embedded in / span the bilayer (integral proteins) or attached to the surface (peripheral proteins);
• Components are free to move laterally — hence "fluid";
• Proteins and lipids are present in a mosaic pattern;
• Glycoproteins / glycolipids present on outer surface;

(c) Award [4 max]:
Similarities (max 1 mark):
• Both involve transport proteins / channel or carrier proteins;
Differences:
• Active transport moves substances against concentration gradient; facilitated diffusion moves with gradient;
• Active transport requires ATP / energy; facilitated diffusion does not;
• Active transport involves carrier proteins only; facilitated diffusion uses channel or carrier proteins;
• Active transport can accumulate substances to high concentrations; facilitated diffusion cannot;`;

