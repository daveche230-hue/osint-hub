const tg = window.Telegram.WebApp;
tg.expand();

async function apiFetch(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Init-Data": tg.initData || "",
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    alert("Ошибка авторизации! Запустите приложение через Telegram.");
    throw new Error("Unauthorized");
  }
  if (response.status === 402) {
    alert("Недостаточно кредитов. Пополните баланс через бота /buy.");
    throw new Error("Payment Required");
  }
  if (response.status === 429) {
    alert("Слишком много запросов. Подождите немного.");
    throw new Error("Too Many Requests");
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || "Ошибка сервера");
  }

  return await response.json();
}

async function loadUserData() {
  try {
    const data = await apiFetch("/api/me");
    document.getElementById("user-info").innerText = `ID: ${data.id || "-"}`;
    document.getElementById("balance").innerText = `Баланс: ${data.requests} кредитов`;
  } catch (err) {
    console.error("Не удалось загрузить профиль:", err);
  }
}

async function runLookup() {
  const value = document.getElementById("target-value").value.trim();
  const statusEl = document.getElementById("status-output");
  const resultEl = document.getElementById("result-output");
  const submitBtn = document.getElementById("submit-btn");

  if (!value) {
    alert("Введите значение для поиска!");
    return;
  }

  submitBtn.disabled = true;
  statusEl.innerText = "Отправка запроса...";
  resultEl.innerText = "";

  try {
    const response = await apiFetch("/api/lookup", {
      method: "POST",
      body: JSON.stringify({ value }),
    });

    loadUserData();

    if (response.job) {
      statusEl.innerText = "Задача в очереди... Ожидание результатов.";
      pollJobStatus(response.job);
    }
  } catch (err) {
    statusEl.innerText = "Ошибка запроса";
    resultEl.innerText = err.message;
    submitBtn.disabled = false;
  }
}

async function pollJobStatus(jobId) {
  const statusEl = document.getElementById("status-output");
  const resultEl = document.getElementById("result-output");
  const submitBtn = document.getElementById("submit-btn");

  const interval = setInterval(async () => {
    try {
      const data = await apiFetch(`/api/job/${jobId}`);

      if (data.status === "running") {
        statusEl.innerText = "Выполняется поиск...";
      } else if (data.status === "done") {
        clearInterval(interval);
        statusEl.innerText = "Выполнено!";
        const parsed = typeof data.result === "string" ? JSON.parse(data.result) : data.result;
        resultEl.innerText = JSON.stringify(parsed, null, 2);
        submitBtn.disabled = false;
      } else if (data.status === "error") {
        clearInterval(interval);
        statusEl.innerText = "Ошибка выполнения задачи";
        resultEl.innerText = data.err || "Неизвестная ошибка воркера";
        submitBtn.disabled = false;
      }
    } catch (err) {
      clearInterval(interval);
      statusEl.innerText = "Ошибка проверки статуса задачи";
      submitBtn.disabled = false;
    }
  }, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  loadUserData();
});
