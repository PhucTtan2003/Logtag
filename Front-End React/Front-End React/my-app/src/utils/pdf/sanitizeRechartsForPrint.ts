export function sanitizeRechartsForPrint(root: HTMLElement) {
  try {
    root
      .querySelectorAll(".recharts-brush, .recharts-tooltip-wrapper")
      .forEach((el) => el.remove());
    root
      .querySelectorAll("[data-print-hide='true']")
      .forEach((el) => ((el as HTMLElement).style.display = "none"));
  } catch {}
}