import { customType } from 'drizzle-orm/pg-core';

export const tstzRange = customType<{
  data: { start: Date; end: Date };
  driverData: string;
}>({
  dataType: () => 'tstzrange',
  toDriver: (v) => `[${v.start.toISOString()},${v.end.toISOString()})`,
  fromDriver: (v) => {
    const match = /^\[([^,]+),([^)]+)\)$/.exec(v);
    if (!match?.[1] || !match[2]) throw new Error(`Unparseable tstzrange: ${v}`);
    return { start: new Date(match[1]), end: new Date(match[2]) };
  },
});
