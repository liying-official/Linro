import { randomBytes } from 'node:crypto';

// These routable-shaped literals are only parsed by offline tests.
const bytes = randomBytes(5);
export const publicIPv4 = [64, bytes[0], bytes[1], bytes[2]].join('.');
export const publicIPv6 = '[3000::' + bytes.readUInt16BE(3).toString(16) + ']';
