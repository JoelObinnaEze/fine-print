import type { KeyboardEvent } from "react";

export function handleTabKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const activeTab = event.target instanceof Element
    ? event.target.closest<HTMLElement>("[role='tab']")
    : null;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']:not(:disabled)")];
  const currentIndex = activeTab ? tabs.indexOf(activeTab as HTMLButtonElement) : -1;
  if (currentIndex < 0) return;

  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  nextTab?.focus();
  nextTab?.click();
}
