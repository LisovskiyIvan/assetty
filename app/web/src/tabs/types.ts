export interface TabHandle {
  /** Root element to append into the tab content area. */
  el: HTMLElement;
  /** Called every time the tab becomes visible (after `el` is in the DOM). */
  activate(): void;
  /** Optional: called when the tab is hidden. */
  deactivate?(): void;
  dispose?(): void;
}
