import { describe, expect, it } from 'vitest';
import {
  isLikelyEmail,
  normalizeFacebook,
  normalizePhone,
  normalizeSocialHandle,
  normalizeWebsite,
  trimToNullable,
  websiteHref,
  whatsappHref,
} from './field-format';

describe('trimToNullable', () => {
  it('returns null for empty / whitespace input', () => {
    expect(trimToNullable('')).toBeNull();
    expect(trimToNullable('   ')).toBeNull();
    expect(trimToNullable('\n\t  ')).toBeNull();
  });
  it('trims surrounding whitespace but preserves inner spaces', () => {
    expect(trimToNullable('  hello world  ')).toBe('hello world');
  });
});

describe('normalizeWebsite', () => {
  it('strips http:// and https:// (case-insensitive)', () => {
    expect(normalizeWebsite('https://example.com')).toBe('example.com');
    expect(normalizeWebsite('http://example.com')).toBe('example.com');
    expect(normalizeWebsite('HTTPS://Example.COM')).toBe('Example.COM');
  });
  it('strips trailing slashes', () => {
    expect(normalizeWebsite('example.com/')).toBe('example.com');
    expect(normalizeWebsite('example.com////')).toBe('example.com');
  });
  it('passes through a bare domain', () => {
    expect(normalizeWebsite('example.com')).toBe('example.com');
    expect(normalizeWebsite('subdomain.example.com/path')).toBe('subdomain.example.com/path');
  });
  it('returns null for empty input', () => {
    expect(normalizeWebsite('')).toBeNull();
    expect(normalizeWebsite('   ')).toBeNull();
    expect(normalizeWebsite('https://')).toBeNull();
  });
});

describe('websiteHref', () => {
  it('prepends https:// when missing', () => {
    expect(websiteHref('example.com')).toBe('https://example.com');
  });
  it('preserves an existing protocol', () => {
    expect(websiteHref('http://example.com')).toBe('http://example.com');
    expect(websiteHref('https://example.com')).toBe('https://example.com');
  });
  it('returns null for empty / nullish', () => {
    expect(websiteHref(null)).toBeNull();
    expect(websiteHref(undefined)).toBeNull();
    expect(websiteHref('')).toBeNull();
    expect(websiteHref('   ')).toBeNull();
  });
});

describe('normalizeSocialHandle', () => {
  it('adds @ when missing', () => {
    expect(normalizeSocialHandle('naili')).toBe('@naili');
  });
  it('preserves a single @', () => {
    expect(normalizeSocialHandle('@naili')).toBe('@naili');
  });
  it('collapses repeated @@@', () => {
    expect(normalizeSocialHandle('@@@naili')).toBe('@naili');
  });
  it('strips instagram.com URLs', () => {
    expect(normalizeSocialHandle('https://www.instagram.com/naili')).toBe('@naili');
    expect(normalizeSocialHandle('instagram.com/naili')).toBe('@naili');
    expect(normalizeSocialHandle('https://instagram.com/naili/')).toBe('@naili');
  });
  it('strips tiktok.com URLs (with or without the @ before the handle)', () => {
    expect(normalizeSocialHandle('https://tiktok.com/@naili')).toBe('@naili');
    expect(normalizeSocialHandle('tiktok.com/naili')).toBe('@naili');
  });
  it('strips path segments beyond the handle', () => {
    expect(normalizeSocialHandle('instagram.com/naili/posts')).toBe('@naili');
    expect(normalizeSocialHandle('@naili/feed')).toBe('@naili');
  });
  it('drops trailing query strings', () => {
    expect(normalizeSocialHandle('instagram.com/naili?utm=ad')).toBe('@naili');
  });
  it('returns null for empty input', () => {
    expect(normalizeSocialHandle('')).toBeNull();
    expect(normalizeSocialHandle('   ')).toBeNull();
    expect(normalizeSocialHandle('@')).toBeNull();
    expect(normalizeSocialHandle('@@@')).toBeNull();
  });
});

describe('normalizeFacebook', () => {
  it('passes through a bare page name (no @ prefix)', () => {
    expect(normalizeFacebook('NailiShoes')).toBe('NailiShoes');
  });
  it('strips facebook.com URLs', () => {
    expect(normalizeFacebook('https://facebook.com/NailiShoes')).toBe('NailiShoes');
    expect(normalizeFacebook('facebook.com/NailiShoes/')).toBe('NailiShoes');
    expect(normalizeFacebook('www.facebook.com/NailiShoes')).toBe('NailiShoes');
  });
  it('strips fb.com URLs', () => {
    expect(normalizeFacebook('fb.com/NailiShoes')).toBe('NailiShoes');
  });
  it('strips facebook.com/pages/<name>/<id> path to the trailing id', () => {
    expect(normalizeFacebook('https://facebook.com/pages/Naili-Shoes/123456')).toBe('123456');
  });
  it('returns null for empty input', () => {
    expect(normalizeFacebook('')).toBeNull();
    expect(normalizeFacebook('   ')).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('trims and collapses whitespace, preserves digits + formatting', () => {
    expect(normalizePhone('  +216  98 765 432  ')).toBe('+216 98 765 432');
    expect(normalizePhone('21698765432')).toBe('21698765432');
  });
  it('returns null for empty input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
  });
});

describe('whatsappHref', () => {
  it('builds a wa.me URL using digit-only input', () => {
    expect(whatsappHref('+216 98 765 432')).toBe('https://wa.me/21698765432');
    expect(whatsappHref('21698765432')).toBe('https://wa.me/21698765432');
    expect(whatsappHref('(216) 98-765-432')).toBe('https://wa.me/21698765432');
  });
  it('returns null when no digits are present', () => {
    expect(whatsappHref(null)).toBeNull();
    expect(whatsappHref('')).toBeNull();
    expect(whatsappHref('   ')).toBeNull();
    expect(whatsappHref('abc')).toBeNull();
  });
});

describe('isLikelyEmail', () => {
  it('returns true for an empty string (no badge before merchant types)', () => {
    expect(isLikelyEmail('')).toBe(true);
    expect(isLikelyEmail('   ')).toBe(true);
  });
  it('returns true for well-formed addresses', () => {
    expect(isLikelyEmail('a@b.c')).toBe(true);
    expect(isLikelyEmail('foo.bar@example.com')).toBe(true);
    expect(isLikelyEmail('foo+tag@example.co.uk')).toBe(true);
  });
  it('returns false for obviously malformed input', () => {
    expect(isLikelyEmail('not an email')).toBe(false);
    expect(isLikelyEmail('missing-at-sign.com')).toBe(false);
    expect(isLikelyEmail('@nodomain')).toBe(false);
    expect(isLikelyEmail('foo@')).toBe(false);
  });
});
