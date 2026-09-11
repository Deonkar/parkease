import { Buffer } from 'node:buffer';

import { customType } from 'drizzle-orm/pg-core';

const EWKB_SRID_FLAG = 0x2000_0000;

export function parseWkbPoint(hex: string): { lng: number; lat: number } {
  const bytes = Buffer.from(hex, 'hex');
  const littleEndian = bytes.readUInt8(0) === 1;
  const typeWithFlags = littleEndian ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
  const offset = 5 + ((typeWithFlags & EWKB_SRID_FLAG) !== 0 ? 4 : 0);
  return {
    lng: littleEndian ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset),
    lat: littleEndian ? bytes.readDoubleLE(offset + 8) : bytes.readDoubleBE(offset + 8),
  };
}

export const geographyPoint = customType<{
  data: { lng: number; lat: number };
  driverData: string;
}>({
  dataType: () => 'geography(Point,4326)',
  toDriver: (v) => `SRID=4326;POINT(${String(v.lng)} ${String(v.lat)})`,
  fromDriver: (v) => parseWkbPoint(v),
});
