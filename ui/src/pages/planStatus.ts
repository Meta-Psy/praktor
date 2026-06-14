import type { IntakeItem } from './intakeStatus';

export type PlanItem = IntakeItem;

// awaitingPlans returns items pending plan approval (caller already sorted by date).
export function awaitingPlans(items: IntakeItem[]): IntakeItem[] {
  return items.filter((it) => it.status === 'awaiting-approval');
}
