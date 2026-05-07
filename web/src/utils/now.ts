import { type ISODate } from '../types';

export function now(): Date {
  return new Date();
}

export function nowISO(): ISODate {
  return new Date().toISOString();
}
