// Priority-aware coordination (SPEC D40): when two developers' work collides, tell each side what the other is
// doing, how urgent each task is, and who should give way. It is advice only: gtv never stops an agent, and
// high/critical conflicts still ask the human.
//
// Who has precedence: the board priority of each side's task, then the earlier due date, then the member level.

import type { Engine } from "./engine.ts";
import { LEVEL_ORDER, PRIORITY_RANK, type BoardTask, type Member, type Priority, type Task } from "../../shared/types.ts";

export interface Standing {
  dev: string;
  task?: Task;
  item?: BoardTask;
  member?: Member;
}

/** What a workspace is working on right now, with its board item and its developer's place in the team. */
export function standingOf(engine: Engine, workspaceId: string, dev: string): Standing {
  const task = engine.store
    .activeTasks()
    .filter((t) => t.workspace_id === workspaceId)
    .at(-1);
  const item = task?.board_id ? engine.board.get(task.board_id) : undefined;
  return { dev, task, item, member: engine.store.member(dev) };
}

const priorityOf = (s: Standing): Priority => s.item?.priority ?? "normal";

/** >0 when `a` goes first, <0 when `b` does, 0 when nothing separates them. */
export function precedence(a: Standing, b: Standing): number {
  const p = PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)];
  if (p) return p;
  const da = a.item?.due_date ?? "9999-12-31";
  const db = b.item?.due_date ?? "9999-12-31";
  if (da !== db) return da < db ? 1 : -1;
  const la = a.member ? LEVEL_ORDER[a.member.level] : -1;
  const lb = b.member ? LEVEL_ORDER[b.member.level] : -1;
  return la - lb;
}

/** `"Cart discounts" (urgent, due 2027-01-31)` */
export function describeWork(s: Standing): string {
  const title = s.item?.title ?? s.task?.title;
  if (!title) return "no registered task";
  const facts = [priorityOf(s), s.item?.due_date ? `due ${s.item.due_date}` : ""].filter(Boolean).join(", ");
  return `"${title}" (${facts})`;
}

const who = (s: Standing) => `${s.dev}${s.member ? ` (${s.member.role}, ${s.member.level})` : ""}`;

/** Header + advice added to a conflict notice for `me` about a clash with `other`. */
export function conflictAdvice(me: Standing, other: Standing, subject: string): { header: string; advice: string; yields: boolean } {
  const header = `Your task: ${describeWork(me)}. ${who(other)}'s task: ${describeWork(other)}.`;
  const order = precedence(me, other);
  const why = (a: Standing, b: Standing) =>
    priorityOf(a) !== priorityOf(b)
      ? "higher priority"
      : (a.item?.due_date ?? "") !== (b.item?.due_date ?? "")
        ? "an earlier due date"
        : "the more senior owner";
  if (order < 0)
    return {
      header,
      yields: true,
      advice: `${other.dev}'s work goes first (${why(other, me)}). Pause your changes to ${subject} or find a workaround (keep the old behaviour, add a new function, adapt to their change), and coordinate with gtv_ask (to_dev "${other.dev}") before touching it. If your user disagrees, ask them.`,
    };
  if (order > 0)
    return {
      header,
      yields: false,
      advice: `Your work goes first (${why(me, other)}); ${other.dev} was asked to give way. Keep going, but tell them (gtv_ask) before you change anything they depend on.`,
    };
  return {
    header,
    yields: false,
    advice: `Same priority: agree with ${other.dev} who changes ${subject} first (gtv_ask to_dev "${other.dev}").`,
  };
}
