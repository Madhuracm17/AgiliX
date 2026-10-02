/**
 * What AppShell shares with the page inside it. The Scrum dashboard hides the
 * sidebar and asks AppShell to show the dashboard top bar instead.
 */
export interface ShellContext {
  /** Hide the sidebar and the normal top bar (the dashboard has its own). */
  setBare: (bare: boolean) => void;
}
