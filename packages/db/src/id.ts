import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

export function uuidv7(): string {
  const now = Date.now();
  const msBytes = Buffer.alloc(6);
  msBytes.writeUIntBE(now, 0, 6);

  const rand = randomBytes(10);
  const byte0 = rand[0] ?? 0;
  const byte2 = rand[2] ?? 0;
  rand[0] = (byte0 & 0x0f) | 0x70;
  rand[2] = (byte2 & 0x3f) | 0x80;

  const msHex = msBytes.toString('hex');
  const randHex = rand.toString('hex');
  return (
    msHex.slice(0, 8) +
    '-' +
    msHex.slice(8, 12) +
    '-' +
    randHex.slice(0, 4) +
    '-' +
    randHex.slice(4, 8) +
    '-' +
    randHex.slice(8, 20)
  );
}
