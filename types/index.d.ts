// The front desk pane's state contract: what the hooks module (hooks/register.tsx) keeps in `$.state`.
// Named in .claude-plugin/plugin.json as "types"; `claude plugin validate` holds every `$.state` key to it.

/** How an architect is doing, in the words the pane shows. */
export type PaneSessionState = 'busy' | 'idle' | 'stuck' | 'dead' | 'no news';

export type PaneItemCategory = 'action' | 'info';

/** One roster item waiting for the user (addressed to the front desk, still open). */
export type PaneItem = {
  id: number;
  kind: string;
  body: string;
  raisedBy: string | null;
  /** The project it belongs to, found from the raiser's name (or the roster's own field); null when unknown. */
  project: string | null;
  /** `action` needs the user (sign-off, question, blocker); `info` is for information only (done report, note). */
  category: PaneItemCategory;
  /** True when the session that raised it has stopped: an answer would reach nobody. */
  isRaiserStopped: boolean;
  minutesAgo: number | null;
};

export type PaneArchitect = {
  sessionId: number;
  name: string;
  state: PaneSessionState;
  minutesQuiet: number | null;
  /** One plain line about its developers, or null when it has none. */
  developers: string | null;
  /** Developer names that are stuck or dead. */
  troubledDevelopers: string[];
  /** e.g. "12 processes (limit 40)", or null when the watchdog has no figure. */
  processes: string | null;
};

/** The project's running project manager: one line in the pane, with its architects one level below. */
export type PaneProjectManager = {
  sessionId: number;
  name: string;
  state: PaneSessionState;
  /** The model it runs on (haiku, sonnet, opus...), or null when unknown. */
  model: string | null;
};

export type PaneWorkstream = {
  name: string;
  branch: string;
  architect: PaneArchitect | null;
  /** True when this architect's parent is the project manager (it draws one level deeper). */
  isManaged: boolean;
};

export type PaneGoal = {
  id: number;
  workstream: string;
  text: string;
  spentUsd: number;
  budgetUsd: number | null;
};

export type PaneProject = {
  name: string;
  spendTodayUsd: number;
  dailyBudgetUsd: number | null;
  /** The running project manager, or null when none runs (or the roster is from before project managers). */
  projectManager: PaneProjectManager | null;
  workstreams: PaneWorkstream[];
  goals: PaneGoal[];
};

/** Everything the pane, band and status line draw, built from one round of roster calls. */
export type PaneView = {
  projects: PaneProject[];
  /** Every open item, as the roster listed them (the band, status line and toasts count these). */
  waiting: PaneItem[];
  /** Items needing the user's action, oldest first. */
  action: PaneItem[];
  /** Information-only items, newest first. */
  info: PaneItem[];
  isPaused: boolean;
  /** Plain lines for sessions over a process limit. */
  overLimits: string[];
  /** Plain lines for roster calls that failed or answered oddly: the pane shows them in place of the missing parts. */
  notes: string[];
  /** When this view was fetched, ms since the epoch. */
  fetchedAt: number;
};

/** A two-step button waiting for its second press: pause everything, stop one architect, close or hide something. */
export type PaneConfirm =
  | { kind: 'pause' }
  | { kind: 'stop'; project: string; workstream: string; name: string }
  | { kind: 'close-item'; id: number }
  | { kind: 'close-goal'; id: number }
  | { kind: 'clear-info' }
  | { kind: 'hide-workstream'; project: string; workstream: string }
  | { kind: 'hide-project'; project: string }
  | null;

/** One thing the user did from the panel that the front desk model has not been told about yet. */
export type PaneNote = {
  id: number;
  kind: string;
  /** The raiser's name, or null. */
  raisedBy: string | null;
  /** The user's answer exactly as typed; absent when the item was cleared or closed without one. */
  answer?: string;
};

/** An answer the user sent from the panel, kept for 24 hours in the "Recently answered" list. */
export type PaneAnswered = {
  id: number;
  kind: string;
  project: string | null;
  answer: string;
  /** ms since the epoch. */
  at: number;
};

declare module 'claude-code' {
  interface PluginState {
    'multi-manager': {
      /** True once this session is the Multi-Manager front desk; nothing is drawn or polled before. */
      isFrontDesk: boolean;
      /** The last view fetched without error (kept while the roster is unavailable). */
      view: PaneView | null;
      /** Why the last poll failed, or null when it worked: the pane says so in a dim line. */
      unavailable: string | null;
      /** Waiting item ids already announced with a toast. */
      announcedItems: number[];
      /** Trouble episodes already announced ("<name>:stuck", "<name>:dead"); dropped when the trouble clears. */
      announcedTrouble: string[];
      confirm: PaneConfirm;
      /** Item ids with an answer on its way, so the Send button is not pressed twice. */
      sendingItems: number[];
      /** Panel actions the front desk model has not heard about yet; emptied by its next turn. */
      paneNotes: PaneNote[];
      /** Answers sent from the panel in the last 24 hours. */
      recentAnswers: PaneAnswered[];
      /** Ids of information lines the user opened to read the full text. */
      expandedInfo: number[];
      /** Whether the "Recently answered" list is open (collapsed by default). */
      isRecentOpen: boolean;
      /** The last scheduled check-in the pane swallowed (nothing to act on), shown in the band; null once a check-in was let through. */
      lastCheck: { at: number; word: 'all quiet' | 'nothing new' | 'paused' } | null;
      /** The last check-in let through to the model: its digest fingerprint and time (ms). Empty fingerprint after a quiet check (the time stays); null when none yet. */
      lastTick: { fingerprint: string; at: number } | null;
    };
  }
}
