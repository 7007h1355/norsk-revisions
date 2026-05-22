// Minimal toast system: append a div, auto-dismiss, no deps.
let host = null;

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  document.body.appendChild(host);
  return host;
}

export function toast(message, opts = {}) {
  const { type = "info", duration = 3500, action } = opts;
  const h = ensureHost();
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="msg"></span>`;
  el.querySelector(".msg").textContent = message;
  if (action) {
    const btn = document.createElement("button");
    btn.className = "act";
    btn.textContent = action.label;
    btn.onclick = () => { action.onClick?.(); dismiss(); };
    el.appendChild(btn);
  }
  const dismiss = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", dismiss);
  h.appendChild(el);
  if (duration > 0) setTimeout(dismiss, duration);
}
