const STUDENT_KEY = "evalua-student";
const EXAM_KEY = "evalua-exam";

let student = null;
let subjects = [];
let subjectId = null;
let exam = null;
let cursor = 0;
let choosing = false;

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

async function rest(path) {
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: headers() });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
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
  for (const section of document.querySelectorAll("#app > section")) {
    section.hidden = section.id !== id;
  }
}

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function percentLabel(learned, total) {
  if (!total || !learned) return "0 %";
  const value = Math.min(100, (learned / total) * 100);
  return `${value.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;
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

async function loadHome() {
  const rows = await rest("students?select=id,name&order=name.asc");
  const list = document.getElementById("student-list");
  list.innerHTML = "";
  document.getElementById("student-empty").hidden = rows.length > 0;
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "student";
    button.innerHTML = "<span class=\"avatar\"></span><span></span>";
    button.querySelector(".avatar").textContent = initials(row.name);
    button.querySelector("span:last-child").textContent = row.name;
    button.addEventListener("click", () => openStudent(row).catch(showRegisterError));
    list.appendChild(button);
  }
  show("home");
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
  document.getElementById("greeting").textContent = student.name;
  const learned = subjects.reduce((sum, item) => sum + item.learned, 0);
  const total = subjects.reduce((sum, item) => sum + item.question_count, 0);
  document.getElementById("summary").textContent =
    `${learned} aprendidas de ${total} · ${percentLabel(learned, total)}`;
  const banner = document.getElementById("banner");
  banner.hidden = !message;
  banner.textContent = message || "";
  const list = document.getElementById("subject-list");
  list.innerHTML = "";
  for (const item of subjects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "subject plain";
    const pending = Math.max(0, item.question_count - item.learned);
    const label = percentLabel(item.learned, item.question_count);
    button.innerHTML = "<strong></strong><span class=\"muted\"></span><span class=\"status pending\"></span><div class=\"track\"><span></span></div>";
    button.querySelector("strong").textContent = item.name;
    button.querySelector(".muted").textContent = `${item.question_count} preguntas`;
    button.querySelector(".status").textContent = pending === 0 && item.question_count > 0
      ? "Completada"
      : `${item.learned} aprendidas`;
    if (pending === 0 && item.question_count > 0) button.querySelector(".status").className = "status done";
    else if (item.learned > 0) button.querySelector(".status").className = "status progress";
    button.querySelector(".track span").style.width = label;
    button.addEventListener("click", () => openSubject(item.id));
    list.appendChild(button);
  }
  show("portal");
}

function openSubject(id) {
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
  show("subject");
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

document.getElementById("register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("register-error");
  error.hidden = true;
  try {
    const created = await rpc("enter_student", {
      p_name: document.getElementById("register-name").value
    });
    document.getElementById("register-name").value = "";
    await openStudent(created);
  } catch (exc) {
    showRegisterError(exc);
  }
});

document.getElementById("change-student").addEventListener("click", async () => {
  student = null;
  sessionStorage.removeItem(STUDENT_KEY);
  await loadHome();
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
  openSubject(subjectId);
});
document.getElementById("result-again").addEventListener("click", () => {
  startExam().catch(async (error) => {
    await loadPortal();
    openSubject(subjectId);
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
  student = loadStoredStudent();
  if (student) {
    try {
      if (await restoreExam()) return;
      await loadPortal();
      return;
    } catch (error) {
      student = null;
      sessionStorage.removeItem(STUDENT_KEY);
    }
  }
  await loadHome();
}

boot().catch((error) => {
  document.getElementById("register-error").hidden = false;
  document.getElementById("register-error").textContent = error.message;
  show("home");
});
