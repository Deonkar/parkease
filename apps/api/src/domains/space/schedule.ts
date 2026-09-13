import type { SpaceSchedule } from '@parkease/contracts/owner';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export function isOpenAt(schedule: SpaceSchedule, date: Date): boolean {
  if (schedule.is24x7) return true;

  const dayIndex = (date.getDay() + 6) % 7;
  const key = DAY_KEYS[dayIndex];
  if (!key) return false;
  const day = schedule.days[key];

  if (!day.isOpen) return false;

  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return hhmm >= day.opensAt && hhmm < day.closesAt;
}
