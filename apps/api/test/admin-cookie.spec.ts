import { describe, expect, it } from 'vitest';

import {
  ADMIN_COOKIE_PATH,
  ADMIN_REFRESH_COOKIE,
  clearAdminCookie,
  readAdminCookie,
  serializeAdminCookie,
} from '../src/roles/public/admin-cookie.js';

const TOKEN = 'token_'.repeat(7); // 42 base64url characters, low entropy on purpose

describe('admin cookie', () => {
  it('names the cookie and scopes its path to the admin auth routes', () => {
    expect(ADMIN_REFRESH_COOKIE).toBe('pe_admin_rt');
    expect(ADMIN_COOKIE_PATH).toBe('/api/v1/auth/admin');
  });

  describe('serializeAdminCookie', () => {
    it('is HttpOnly, SameSite=Strict, path-scoped, 7 days', () => {
      const header = serializeAdminCookie(TOKEN, { secure: false });
      expect(header).toContain(`pe_admin_rt=${TOKEN}`);
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Strict');
      expect(header).toContain('Path=/api/v1/auth/admin');
      expect(header).toContain('Max-Age=604800');
    });

    it('carries Secure iff asked', () => {
      expect(serializeAdminCookie(TOKEN, { secure: true })).toContain('Secure');
      expect(serializeAdminCookie(TOKEN, { secure: false })).not.toContain('Secure');
    });

    it('refuses a value that is not a base64url token (no header injection)', () => {
      expect(() => serializeAdminCookie('abc;Path=/', { secure: false })).toThrow();
      expect(() => serializeAdminCookie('a\r\nSet-Cookie: x=1', { secure: false })).toThrow();
    });
  });

  describe('clearAdminCookie', () => {
    it('expires the cookie at the same path and attributes', () => {
      const header = clearAdminCookie({ secure: true });
      expect(header).toContain('pe_admin_rt=;');
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('Path=/api/v1/auth/admin');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Strict');
      expect(header).toContain('Secure');
      expect(clearAdminCookie({ secure: false })).not.toContain('Secure');
    });
  });

  describe('readAdminCookie', () => {
    it('finds the token among other cookies', () => {
      expect(readAdminCookie(`a=1; pe_admin_rt=${TOKEN}; b=2`)).toBe(TOKEN);
    });

    it('returns null when the header or the cookie is missing', () => {
      expect(readAdminCookie(undefined)).toBeNull();
      expect(readAdminCookie('')).toBeNull();
      expect(readAdminCookie('a=1; b=2')).toBeNull();
    });

    it('rejects a header-injection payload', () => {
      expect(readAdminCookie('pe_admin_rt=abc;%0d%0aSet-Cookie')).toBeNull();
      expect(readAdminCookie(`pe_admin_rt=${TOKEN}%0d%0a`)).toBeNull();
    });

    it('rejects a value outside [A-Za-z0-9_-]{20,128}', () => {
      expect(readAdminCookie('pe_admin_rt=short')).toBeNull();
      expect(readAdminCookie(`pe_admin_rt=${'a'.repeat(129)}`)).toBeNull();
      expect(readAdminCookie(`pe_admin_rt=${'a'.repeat(19)}!`)).toBeNull();
      expect(readAdminCookie(`pe_admin_rt=${'a'.repeat(128)}`)).toBe('a'.repeat(128));
    });

    it('takes the first when the cookie appears twice, even if the second is valid', () => {
      const other = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
      expect(readAdminCookie(`pe_admin_rt=${TOKEN}; pe_admin_rt=${other}`)).toBe(TOKEN);
      expect(readAdminCookie(`pe_admin_rt=bad; pe_admin_rt=${other}`)).toBeNull();
    });

    it('does not match a cookie whose name merely ends in the same text', () => {
      expect(readAdminCookie(`x_pe_admin_rt=${TOKEN}`)).toBeNull();
    });
  });
});
