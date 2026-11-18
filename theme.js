// Theme preference is deliberately kept in memory, never in browser storage.
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
let chosenTheme = null;

function applyTheme() {
  const dark = chosenTheme ? chosenTheme === "dark" : systemTheme.matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const button = document.getElementById("theme-toggle");
  const label = dark ? "Hellen Modus einschalten" : "Dunklen Modus einschalten";
  if (button) {
    button.setAttribute("aria-label", label);
    button.title = label;
    button.setAttribute("aria-pressed", String(dark));
    button
      .querySelector("use")
      .setAttribute("href", dark ? "#i-sun" : "#i-moon");
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#171622" : "#f7f7fb");
}

applyTheme();
systemTheme.addEventListener("change", () => {
  if (!chosenTheme) applyTheme();
});
document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    chosenTheme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme();
  });
});
