const isActiveStatus = (status: string): boolean => status === "working" || status === "background";

export const shouldPreserveCardPosition = (previousStatus: string, nextStatus: string): boolean => {
  return previousStatus !== nextStatus && isActiveStatus(previousStatus) && isActiveStatus(nextStatus);
};

export const nextSortActivityAt = <T extends { status: string; sortActivityAt: number }>(
  previous: T | null | undefined,
  nextStatus: string,
  timestamp: number
): number => {
  if (!previous) return timestamp;
  return shouldPreserveCardPosition(previous.status, nextStatus) ? previous.sortActivityAt : timestamp;
};

export const compareSessionsByDisplayOrder = <T extends { agentKey: string; sortActivityAt: number }>(
  a: T,
  b: T
): number => {
  return b.sortActivityAt - a.sortActivityAt || a.agentKey.localeCompare(b.agentKey);
};

export const sortSessionsForDisplay = <T extends { agentKey: string; sortActivityAt: number }>(
  sessions: readonly T[]
): T[] => {
  return [...sessions].sort(compareSessionsByDisplayOrder);
};
