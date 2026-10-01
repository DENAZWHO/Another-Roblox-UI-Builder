import type { TriggerKind } from '../model/types';

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  load: 'On load',
  manual: 'Manual (call from code)',
  click: 'On click',
  hoverEnter: 'On hover',
  hoverLeave: 'On hover end',
  pressDown: 'On press',
  pressUp: 'On release',
};
