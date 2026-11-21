import type React from 'react';

export function handleDialogKey(event: React.KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
    ),
  ].filter((node) => node.getClientRects().length > 0);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || !event.currentTarget.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || !event.currentTarget.contains(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}

export function focusDialog(panel: HTMLElement | null) {
  if (!panel || panel.contains(document.activeElement)) return;
  (
    panel.querySelector<HTMLElement>('[autofocus]') ??
    panel.querySelector<HTMLElement>(
      'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])',
    )
  )?.focus();
}
export class DialogFocus {
  private trigger: HTMLElement | null = null;
  capture() {
    this.trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  restore() {
    const trigger = this.trigger;
    this.trigger = null;
    if (trigger?.isConnected) trigger.focus();
  }
}
