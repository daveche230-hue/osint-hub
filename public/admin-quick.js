(() => {
  const mount = () => {
    const adw = document.getElementById("adw");
    if (!adw || !adw.querySelector('[data-act="admin"]') || document.getElementById("qa-box")) return;

    const wrap = document.createElement("div");
    wrap.id = "qa-box";
    wrap.style.cssText = "display:flex;gap:8px;margin-top:10px";
    wrap.innerHTML = `
      <input id="qa-in" class="f" style="height:42px;font-size:14px" placeholder="@username или ID" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button id="qa-btn" class="b2" style="margin:0;white-space:nowrap;background:var(--acc);color:var(--acc-fg);border:0">∞ Безлимит</button>
    `;
    adw.appendChild(wrap);

    const grant = async () => {
      const inp = document.getElementById("qa-in");
      const btn = document.getElementById("qa-btn");
      const v = inp.value.trim();
      if (!v) return alert("Введи @username или ID");
      btn.disabled = true;
      try {
        const hdr = { "Content-Type": "application/json", "X-Init-Data": window.Telegram?.WebApp?.initData || "" };
        let id = /^\d+$/.test(v) ? Number(v) : null;
        if (!id) {
          const r1 = await fetch("/api/admin/find", { method: "POST", headers: hdr, body: JSON.stringify({ username: v }) });
          const d1 = await r1.json();
          if (!r1.ok) throw new Error(d1.error || "Юзер не найден (пусть сначала нажмёт /start в боте)");
          id = d1.id;
        }
        const r2 = await fetch("/api/admin/set", { method: "POST", headers: hdr, body: JSON.stringify({ id, unlimited: true }) });
        const d2 = await r2.json();
        if (!r2.ok) throw new Error(d2.error || "Ошибка выдачи");
        inp.value = "";
        alert(`Готово! Безлимит включён для ID ${d2.user.id}`);
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    };

    document.getElementById("qa-btn").onclick = grant;
    document.getElementById("qa-in").onkeydown = (e) => { if (e.key === "Enter") grant(); };
  };

  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  mount();
})();
