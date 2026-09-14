import type { SpaceDetail } from '@parkease/contracts/owner';

/**
 * In-memory store backing the dev mock session, so listings created without an
 * API server still show up in the list. Resets on reload — dev only.
 */
const spaces: SpaceDetail[] = [];

export function addDevMockSpace(space: SpaceDetail): void {
  spaces.unshift(space);
}

export function listDevMockSpaces(): SpaceDetail[] {
  return spaces;
}

export function findDevMockSpace(id: string): SpaceDetail | undefined {
  return spaces.find((space) => space.id === id);
}
