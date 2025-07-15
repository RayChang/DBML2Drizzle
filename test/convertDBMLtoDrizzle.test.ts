import fs from 'fs';
import path from 'path';
import convertDBMLtoDrizzle from '../src/convertDBMLtoDrizzle';
import { describe, it, expect } from 'vitest';

const dbmlPath = path.resolve(__dirname, 'coverage.dbml');
const dbmlCode = fs.readFileSync(dbmlPath, 'utf-8');

describe('convertDBMLtoDrizzle baseline coverage', () => {
  it('should convert coverage.dbml without throwing', () => {
    expect(() => convertDBMLtoDrizzle(dbmlCode)).not.toThrow();
  });

  it('output should contain definitions for all tables', () => {
    const output = convertDBMLtoDrizzle(dbmlCode);
    expect(output).toContain('export const users');
    expect(output).toContain('export const profiles');
    expect(output).toContain('export const orders');
    expect(output).toContain('export const composite_test');
  });
});
