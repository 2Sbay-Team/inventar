import { v4 } from 'uuid';
import { type UUID } from '../types';

export function newUUID(): UUID {
  return v4();
}
