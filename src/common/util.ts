import { createHash } from 'crypto';

export const hashValue = (value: unknown): string => {
  const hash = createHash('md5');
  hash.update(JSON.stringify(value));
  return hash.digest('hex');
};
