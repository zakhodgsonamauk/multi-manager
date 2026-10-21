// The front desk pane's state contract: what the hooks module (hooks/register.tsx) keeps in `$.state`.
// Named in .claude-plugin/plugin.json as "types"; `claude plugin validate` holds every `$.state` key to it.

/** How an architect is doing, in the words the pane shows. */
export type PaneSessionState = 'busy' | 'idle' | 'stuck' | 'dead' | 'no news';

/** One roster item waiting for the user (addressed to the front desk, still open). */
export type PaneItem = {
  id: number;
  kind: string;
  body: string;
  raisedBy: string | null;
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

export type PaneWorkstream = {
  name: string;
  branch: string;
  architect: PaneArchitect | null;
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
  workstreams: PaneWorkstream[];
  goals: PaneGoal[];
};

/** Everything the pane, band and status line draw, built from one round of roster calls. */
export type PaneView = {
  projects: PaneProject[];
  waiting: PaneItem[];
  isPaused: boolean;
  /** Plain lines for sessions over a process limit. */
  overLimits: string[];
  /** When this view was fetched, ms since the epoch. */
  fetchedAt: number;
};

/** A two-step button waiting for its second press: pause everything, or stop one architect. */
export type PaneConfirm = { kind: 'pause' } | { kind: 'stop'; project: string; workstream: string; name: string } | null;

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
    };
  }
}
