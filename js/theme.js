// Tema de cores: a escolha fica só neste browser (localStorage). O tema "roxo" é o original.
const THEMES = ["roxo", "oceano", "brasa"];
const root = document.documentElement;

function currentTheme() {
  return THEMES.includes(root.dataset.theme) ? root.dataset.theme : "roxo";
}

function paintPicker() {
  for (const btn of document.querySelectorAll(".theme-swatch")) {
    btn.classList.toggle("active", btn.dataset.theme === currentTheme());
  }
}

function applyTheme(theme) {
  if (theme === "roxo") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // sem localStorage: o tema só dura enquanto a página estiver aberta
  }
  paintPicker();
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-swatch");
  if (btn) applyTheme(btn.dataset.theme);
});

paintPicker();
