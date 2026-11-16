/* Быстрая выдача безлимита: поле на главном экране, видно только админу.
   Подключается одной строкой в index.html: <script src="/admin-quick.js"></script> */
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  const w = document.getElementById("adw");
  if (!w) return;

  const toast = (m) => {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = m;
    t.classList.add("on");
    setTimeout(() => t.classList.remove("on"), 2400);
  };

  async function api(path, body) {
    const r = await fetch("/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Init-Data": (tg && tg.initData) || "" },
      body: JSON.stringify(body || {}),
    });
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || j.detail || "Ошибка " + r.status);
    return j;
  }

  async function grant() {
    const i = document.getElementById("qa");
    const v = ((i && i.value) || "").trim();
    if (!v) return toast("Вставь @username или ID");
    try {
      const id = /^\d+$/.test(v) ? +v : (await api("admin/find", { username: v })).id;
      const r = await api("admin/set", { id, unlimited: true });
      toast("Безлимит выдан: ID " + r.user.id);
      i.value = "";
    } catch (e) {
      toast(e.message);
    }
  }

  function mount() {
    // поле появляется только когда админка включена (есть кнопка «Админка»)
    if (!w.querySelector('[data-act="admin"]') || w.querySelector("#qa")) return;
    w.insertAdjacentHTML(
      "afterbegin",
      '<div class="srch" style="margin-top:10px;padding-right:8px">' +
        '<input id="qa" placeholder="Безлимит: @username или ID" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send">' +
        '<button class="vbuy" id="qab">Выдать</button></div>'
    );
  }

  w.addEventListener("click", (e) => { if (e.target.closest("#qab")) grant(); });
  w.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "qa") grant(); });
  new MutationObserver(mount).observe(w, { childList: true });
  mount();
})();
