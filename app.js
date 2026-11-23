const STUDENT_KEY = "evalua-student";
const EXAM_KEY = "evalua-exam";

let student = null;
let subjects = [];
let subjectId = null;
let exam = null;
let cursor = 0;
let choosing = false;
let pendingRemoval = null;

const STATUS_ICONS = {
  pending: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.6V8.2l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  progress: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.4 12.6V9.2M8 12.6V5.6M13.6 12.6V3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
};

function config() {
  const value = window.EVALUA || {};
  if (!value.url || !value.anonKey) {
    throw new Error("Falta la clave anon en config.js.");
  }
  return value;
}

function headers(extra) {
  const { anonKey } = config();
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    ...extra
  };
}

async function readError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  const message = payload && (payload.message || payload.error_description || payload.hint);
  return message || "No se pudo completar la operación.";
}

async function rpc(name, body) {
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body || {})
  });
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return null;
  return response.json();
}

function show(id) {
  if (id !== "opening") document.documentElement.classList.remove("is-opening");
  for (const section of document.querySelectorAll("#app > section")) {
    section.hidden = section.id !== id;
  }
}

function initials(name) {
  const parts = name.split(/\s+/).filter((part) => /\p{L}/u.test(part));
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatPercent(value) {
  const number = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(number)) return "0%";
  if (Math.abs(number - Math.round(number)) < 0.05) return `${Math.round(number)}%`;
  return `${number.toFixed(1)}%`;
}

function percentLabel(learned, total) {
  if (!total || learned <= 0) return "0%";
  return formatPercent(Math.min(100, (learned / total) * 100));
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function setStatus(status, kind, label) {
  status.hidden = false;
  status.className = `status ${kind}`;
  status.innerHTML = `${STATUS_ICONS[kind] || ""}<span></span>`;
  status.querySelector("span").textContent = label;
}

function equalizeSubjectCards() {
  const portal = document.getElementById("portal");
  const cards = [...document.querySelectorAll("#subject-list .subject")];
  const add = document.querySelector("#subject-list .add-subject");
  if (!portal || portal.hidden) return;
  for (const card of cards) card.style.minHeight = "";
  if (add) add.style.minHeight = "";
  if (!cards.length) return;
  const tallest = Math.max(...cards.map((card) => card.getBoundingClientRect().height));
  if (!tallest) return;
  const height = `${Math.ceil(tallest)}px`;
  for (const card of cards) card.style.minHeight = height;
  if (add) add.style.minHeight = height;
}

function showBanner(text, kind) {
  const node = document.getElementById("banner");
  node.hidden = !text;
  node.textContent = text || "";
  node.className = kind === "bad" ? "banner bad" : "banner";
}

function friendlyError(error) {
  if (/could not find the function|schema cache|PGRST202/i.test(error.message || "")) {
    return "Falta aplicar la actualización de la base. Pega el archivo SQL nuevo en el editor de Supabase y vuelve a cargar.";
  }
  return error.message;
}

function saveStudent(value) {
  student = value;
  sessionStorage.setItem(STUDENT_KEY, JSON.stringify(value));
}

function loadStoredStudent() {
  try {
    return JSON.parse(sessionStorage.getItem(STUDENT_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function saveExamPlace() {
  if (!exam) {
    sessionStorage.removeItem(EXAM_KEY);
    return;
  }
  const current = exam.questions[cursor];
  sessionStorage.setItem(EXAM_KEY, JSON.stringify({
    examId: exam.exam_id,
    ordinal: current ? current.ordinal : null
  }));
}

function loadHome() {
  show("home");
}

async function enterFromWorkspace(code) {
  const response = await fetch("https://buensoft.com/workspace/api/evalua.php", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "redeem", code })
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }
  if (!response.ok || !payload.name) {
    throw new Error(payload.error || "No se pudo entrar con la cuenta del workspace.");
  }
  const created = await rpc("enter_student", { p_name: payload.name });
  await openStudent(created);
}

function showRegisterError(error) {
  const node = document.getElementById("register-error");
  node.hidden = false;
  node.textContent = error.message;
}

async function openStudent(value) {
  saveStudent({ id: value.id, name: value.name });
  await loadPortal();
}

async function loadPortal(message) {
  subjects = await rpc("student_progress", { p_student_id: student.id });
  document.getElementById("avatar").textContent = initials(student.name);
  document.getElementById("greeting").textContent = `${greeting()}, ${student.name}`;
  const learned = subjects.reduce((sum, item) => sum + item.learned, 0);
  const total = subjects.reduce((sum, item) => sum + item.question_count, 0);
  document.getElementById("summary").textContent = total
    ? `Has aprendido ${learned} de ${total} preguntas · ${percentLabel(learned, total)}`
    : "Todavía no hay preguntas aprendidas.";
  showBanner(message);
  const list = document.getElementById("subject-list");
  list.innerHTML = "";
  document.getElementById("subject-empty").hidden = subjects.length > 0;
  for (const item of subjects) {
    const card = document.createElement("article");
    card.className = "subject-card";
    const dismiss = document.createElement("button");
    dismiss.className = "dismiss";
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", `Quitar ${item.name}`);
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => askRemove(item));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "subject";
    button.innerHTML = "<span class=\"status\" hidden></span><strong></strong><span class=\"muted\"></span><span class=\"muted latest\"></span><div class=\"track\"><span></span></div>";
    const status = button.querySelector(".status");
    const completed = item.question_count > 0 && item.learned >= item.question_count;
    if (completed) setStatus(status, "done", "🏆 Completada");
    else if (item.learned > 0) setStatus(status, "progress", "En progreso");
    else setStatus(status, "pending", "Pendiente");
    button.querySelector("strong").textContent = item.name;
    button.querySelector(".muted").textContent =
      `${item.learned} de ${item.question_count} · ${percentLabel(item.learned, item.question_count)}`;
    const latest = button.querySelector(".latest");
    if (item.latest_questions != null) {
      const noun = item.latest_questions === 1 ? "pregunta" : "preguntas";
      latest.textContent =
        `Último examen: ${item.latest_correct} correctas de ${item.latest_questions} ${noun} · ${formatPercent(item.latest_score)}`;
    } else {
      latest.hidden = true;
    }
    button.querySelector(".track span").style.width = percentLabel(item.learned, item.question_count);
    button.addEventListener("click", () => openSubject(item.id));
    card.append(dismiss, button);
    list.appendChild(card);
  }
  const add = document.createElement("button");
  add.className = "add-subject";
  add.type = "button";
  add.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 14v36M14 32h36" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg><span>Agregar materia</span>';
  add.addEventListener("click", () => {
    openCatalog().catch((error) => showBanner(friendlyError(error), "bad"));
  });
  list.appendChild(add);
  show("portal");
  equalizeSubjectCards();
}

function askRemove(item) {
  pendingRemoval = item;
  const text = document.getElementById("remove-text");
  text.textContent = item.learned > 0
    ? `¿Quitas «${item.name}» de tu portal? Se perderá todo tu progreso en esta materia, incluidas las preguntas aprendidas y los exámenes terminados.`
    : `¿Quitas «${item.name}» de tu portal?`;
  document.getElementById("remove-subject").showModal();
}

function showCatalogList() {
  document.getElementById("catalog-ai").hidden = true;
  document.getElementById("catalog-main").hidden = false;
  document.getElementById("ai-copied").hidden = true;
}

async function openCatalog() {
  showCatalogList();
  const dialog = document.getElementById("catalog");
  const list = document.getElementById("catalog-list");
  const error = document.getElementById("catalog-error");
  error.hidden = true;
  list.innerHTML = "";
  const rows = await rpc("available_subjects", { p_student_id: student.id });
  document.getElementById("catalog-empty").hidden = rows.length > 0;
  for (const item of rows) {
    const button = document.createElement("button");
    button.className = "choice";
    button.type = "button";
    button.innerHTML = "<strong></strong><br><span class=\"muted\"></span>";
    button.querySelector("strong").textContent = item.name;
    button.querySelector(".muted").textContent = `${item.question_count} preguntas`;
    button.addEventListener("click", async () => {
      try {
        const outcome = await rpc("place_subject", {
          p_student_id: student.id,
          p_subject_id: item.id
        });
        dialog.close();
        await loadPortal(outcome.message);
      } catch (exc) {
        error.hidden = false;
        error.textContent = friendlyError(exc);
      }
    });
    list.appendChild(button);
  }
  dialog.showModal();
}

function subjectPayload(text) {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("No se encontró un JSON de materia en el archivo.");
  }
  try {
    const data = JSON.parse(trimmed.slice(start, end + 1));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("El archivo no es un JSON de materia.");
    }
    return data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("El archivo no es un JSON válido.");
    }
    throw error;
  }
}

async function openSubject(id) {
  subjectId = id;
  const item = subjects.find((subject) => subject.id === id);
  if (!item) return;
  document.getElementById("subject-name").textContent = item.name;
  document.getElementById("subject-description").textContent = item.description || "";
  const label = percentLabel(item.learned, item.question_count);
  document.getElementById("subject-percent").textContent = label;
  document.getElementById("subject-bar").style.width = label;
  document.getElementById("stat-learned").textContent = item.learned;
  document.getElementById("stat-pending").textContent = Math.max(0, item.question_count - item.learned);
  document.getElementById("stat-exams").textContent = item.exam_count;
  const banner = document.getElementById("subject-banner");
  banner.hidden = true;
  const start = document.getElementById("start-exam");
  const finished = item.question_count > 0 && item.learned >= item.question_count;
  start.disabled = finished;
  start.textContent = finished ? "Materia completada" : "Comenzar examen";
  const answersBlock = document.getElementById("answers-block");
  const answers = document.getElementById("answers");
  answers.innerHTML = "";
  answersBlock.hidden = true;
  show("subject");
  if (!finished) return;
  try {
    const rows = await rpc("subject_answers", {
      p_student_id: student.id,
      p_subject_id: id
    });
    renderAnswers(Array.isArray(rows) ? rows : []);
  } catch (error) {
    banner.hidden = false;
    banner.className = "banner bad";
    banner.textContent = friendlyError(error);
  }
}

function renderAnswers(rows) {
  const answersBlock = document.getElementById("answers-block");
  const answers = document.getElementById("answers");
  answers.innerHTML = "";
  answersBlock.hidden = rows.length === 0;
  rows.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = "answer";
    const prompt = document.createElement("p");
    prompt.textContent = `${index + 1}. ${item.prompt}`;
    const answer = document.createElement("p");
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = "Respuesta correcta: ";
    const value = document.createElement("strong");
    value.textContent = item.answer;
    answer.append(label, value);
    row.append(prompt, answer);
    answers.appendChild(row);
  });
}

function renderQuestion() {
  const questions = exam.questions;
  const question = questions[cursor];
  const position = cursor + 1;
  document.getElementById("exam-subject").textContent = exam.subject_name;
  document.getElementById("exam-count").textContent = `Pregunta ${position} de ${questions.length}`;
  document.getElementById("exam-bar").style.width = `${(position / questions.length) * 100}%`;
  document.getElementById("exam-review").hidden = !question.review;
  document.getElementById("exam-prompt").textContent = question.prompt;
  document.getElementById("exam-error").hidden = true;
  const feedback = document.getElementById("feedback");
  const explanation = document.getElementById("explanation");
  const next = document.getElementById("next");
  const options = document.getElementById("options");
  options.innerHTML = "";
  const revealed = question.answered === true;
  question.options.forEach((text, index) => {
    const button = document.createElement("button");
    button.className = "option";
    button.type = "button";
    button.innerHTML = "<span class=\"badge\"></span><span></span>";
    button.querySelector(".badge").textContent = "ABCDEFGH"[index] || "";
    button.querySelector("span:last-child").textContent = text;
    if (revealed) {
      if (text === question.correct_text) button.classList.add("correct");
      if (text === question.selected_text && question.correct === false) button.classList.add("incorrect");
      button.disabled = true;
    } else {
      button.addEventListener("click", () => choose(text, button));
    }
    options.appendChild(button);
  });
  if (revealed) {
    feedback.hidden = false;
    feedback.className = question.correct ? "ok" : "bad";
    feedback.textContent = question.correct
      ? "Correcta"
      : "Incorrecta. La respuesta correcta está marcada.";
    explanation.hidden = !question.explanation;
    explanation.textContent = question.explanation || "";
    next.disabled = false;
  } else {
    feedback.hidden = true;
    explanation.hidden = true;
    explanation.textContent = "";
    next.disabled = true;
  }
  next.textContent = position === questions.length ? "Ver resultados" : "Siguiente pregunta";
  show("exam");
  saveExamPlace();
}

async function choose(text, button) {
  if (choosing) return;
  const question = exam.questions[cursor];
  if (!question || question.answered) return;
  choosing = true;
  button.classList.add("hot");
  const ordinal = question.ordinal;
  try {
    const data = await rpc("answer_question", {
      p_exam_id: exam.exam_id,
      p_ordinal: ordinal,
      p_selected: text
    });
    exam.questions = data.questions;
    const match = exam.questions.find((item) => item.ordinal === ordinal && item.selected_text === text)
      || exam.questions.find((item) => item.ordinal === ordinal + 1 && item.question_id === question.question_id && item.selected_text === text)
      || exam.questions.find((item) => item.question_id === question.question_id && item.selected_text === text);
    cursor = Math.max(0, exam.questions.indexOf(match));
    renderQuestion();
  } catch (error) {
    const node = document.getElementById("exam-error");
    node.hidden = false;
    node.textContent = error.message;
  } finally {
    choosing = false;
  }
}

async function startExam() {
  const data = await rpc("start_exam", {
    p_student_id: student.id,
    p_subject_id: subjectId
  });
  exam = data;
  cursor = 0;
  renderQuestion();
}

async function finishExam() {
  const result = await rpc("finish_exam", { p_exam_id: exam.exam_id });
  exam = null;
  cursor = 0;
  saveExamPlace();
  subjectId = result.subject_id;
  const score = Number(result.score);
  document.getElementById("score").textContent = `${score.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;
  const noun = result.question_count === 1 ? "pregunta" : "preguntas";
  document.getElementById("result-summary").textContent =
    `${result.correct_count} correctas y ${result.incorrect_count} incorrectas en ${result.question_count} ${noun}.`;
  document.getElementById("result-correct").textContent = result.correct_count;
  document.getElementById("result-incorrect").textContent = result.incorrect_count;
  document.getElementById("result-learned").textContent = result.learned_now;
  const learned = document.getElementById("result-learned-line");
  if (result.learned_now === 0) {
    learned.textContent = "Ninguna pregunta llegó al segundo acierto en este examen.";
  } else if (result.learned_now === 1) {
    learned.textContent = "Aprendiste 1 pregunta en este examen. Ya no volverá a salir.";
  } else {
    learned.textContent = `Aprendiste ${result.learned_now} preguntas en este examen. Ya no volverán a salir.`;
  }
  const label = `${Number(result.percent).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;
  document.getElementById("result-progress").textContent =
    `Progreso de ${result.subject_name}: ${result.learned} de ${result.total} · ${label}`;
  document.getElementById("result-bar").style.width = label;
  const again = document.getElementById("result-again");
  const completed = result.total > 0 && result.learned >= result.total;
  again.disabled = completed;
  again.textContent = completed ? "Materia completada" : "Otro examen";
  show("result");
}

async function restoreExam() {
  let stored = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(EXAM_KEY) || "null");
  } catch (error) {
    stored = null;
  }
  if (!stored || !stored.examId) return false;
  try {
    exam = await rpc("exam_state", { p_exam_id: stored.examId });
  } catch (error) {
    sessionStorage.removeItem(EXAM_KEY);
    return false;
  }
  const index = exam.questions.findIndex((item) => item.ordinal === stored.ordinal);
  cursor = index >= 0 ? index : exam.questions.findIndex((item) => !item.answered);
  if (cursor < 0) cursor = 0;
  renderQuestion();
  return true;
}

document.getElementById("change-student").addEventListener("click", () => {
  student = null;
  exam = null;
  sessionStorage.removeItem(STUDENT_KEY);
  sessionStorage.removeItem(EXAM_KEY);
  const error = document.getElementById("register-error");
  error.hidden = true;
  loadHome();
});

document.getElementById("back-portal").addEventListener("click", () => {
  loadPortal().catch((error) => {
    document.getElementById("subject-banner").hidden = false;
    document.getElementById("subject-banner").textContent = error.message;
  });
});

document.getElementById("start-exam").addEventListener("click", () => {
  startExam().catch((error) => {
    const banner = document.getElementById("subject-banner");
    banner.hidden = false;
    banner.textContent = error.message;
  });
});

document.getElementById("next").addEventListener("click", () => {
  if (cursor < exam.questions.length - 1) {
    cursor += 1;
    renderQuestion();
    return;
  }
  finishExam().catch((error) => {
    const node = document.getElementById("exam-error");
    node.hidden = false;
    node.textContent = error.message;
  });
});

document.getElementById("abandon").addEventListener("click", () => {
  document.getElementById("leave").showModal();
});

document.getElementById("leave-confirm").addEventListener("click", async () => {
  const dialog = document.getElementById("leave");
  dialog.close();
  try {
    if (exam) await rpc("abandon_exam", { p_exam_id: exam.exam_id });
  } catch (error) {
    if (!/No se encontró el examen/.test(error.message)) {
      const node = document.getElementById("exam-error");
      node.hidden = false;
      node.textContent = error.message;
      return;
    }
  }
  exam = null;
  saveExamPlace();
  await loadPortal("El examen no se guardó.");
});

document.getElementById("result-menu").addEventListener("click", () => loadPortal());
document.getElementById("result-back").addEventListener("click", async () => {
  await loadPortal();
  await openSubject(subjectId);
});
document.getElementById("remove-confirm").addEventListener("click", async () => {
  const dialog = document.getElementById("remove-subject");
  const item = pendingRemoval;
  dialog.close();
  if (!item) return;
  try {
    const outcome = await rpc("remove_subject", {
      p_student_id: student.id,
      p_subject_id: item.id
    });
    await loadPortal(outcome.message);
  } catch (error) {
    showBanner(friendlyError(error), "bad");
  }
});

document.getElementById("catalog-upload-button").addEventListener("click", () => {
  document.getElementById("catalog-upload").click();
});

document.getElementById("catalog-upload").addEventListener("change", async (event) => {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  const error = document.getElementById("catalog-error");
  error.hidden = true;
  if (file.size > 20 * 1024 * 1024) {
    error.hidden = false;
    error.textContent = "El archivo supera el tamaño máximo de 20 MB.";
    return;
  }
  try {
    const payload = subjectPayload(await file.text());
    const outcome = await rpc("import_subject", {
      p_student_id: student.id,
      p_payload: payload
    });
    document.getElementById("catalog").close();
    await loadPortal(outcome.message);
  } catch (exc) {
    error.hidden = false;
    error.textContent = friendlyError(exc);
  }
});

document.getElementById("ai-help-open").addEventListener("click", () => {
  document.getElementById("catalog-main").hidden = true;
  document.getElementById("catalog-ai").hidden = false;
});

document.getElementById("ai-back").addEventListener("click", () => {
  showCatalogList();
});

document.getElementById("ai-copy").addEventListener("click", async () => {
  const prompt = document.getElementById("ai-prompt").value;
  try {
    await navigator.clipboard.writeText(prompt);
    document.getElementById("ai-copied").hidden = false;
  } catch (error) {
    document.getElementById("ai-prompt").select();
  }
});

window.addEventListener("resize", equalizeSubjectCards);

document.getElementById("result-again").addEventListener("click", () => {
  startExam().catch(async (error) => {
    await loadPortal();
    await openSubject(subjectId);
    const banner = document.getElementById("subject-banner");
    banner.hidden = false;
    banner.textContent = error.message;
  });
});

async function boot() {
  try {
    config();
  } catch (error) {
    document.getElementById("register-error").hidden = false;
    document.getElementById("register-error").textContent = error.message;
    show("home");
    return;
  }
  const params = new URLSearchParams(location.search);
  const code = params.get("entrada") || "";
  if (/^[a-f0-9]{32}$/.test(code)) {
    params.delete("entrada");
    const query = params.toString();
    history.replaceState(null, "", location.pathname + (query ? `?${query}` : "") + location.hash);
    try {
      await enterFromWorkspace(code);
      return;
    } catch (error) {
      document.documentElement.classList.remove("is-opening");
      showRegisterError(error);
      show("home");
      return;
    }
  }
  student = loadStoredStudent();
  if (student) {
    try {
      if (await restoreExam()) return;
      await loadPortal();
      return;
    } catch (error) {
      student = null;
      sessionStorage.removeItem(STUDENT_KEY);
      document.documentElement.classList.remove("is-opening");
    }
  }
  document.documentElement.classList.remove("is-opening");
  await loadHome();
}

boot().catch((error) => {
  document.getElementById("register-error").hidden = false;
  document.getElementById("register-error").textContent = error.message;
  show("home");
});
