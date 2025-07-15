import fs from 'fs';
import path from 'path';
import convertDBMLtoDrizzle from '../src/convertDBMLtoDrizzle';
import { describe, it, expect } from 'vitest';

const dbmlPath1 = path.resolve(__dirname, 'coverage.dbml');
const dbmlPath2 = path.resolve(__dirname, 'coverage2.dbml');
const dbmlCode1 = fs.readFileSync(dbmlPath1, 'utf-8');
const dbmlCode2 = fs.readFileSync(dbmlPath2, 'utf-8');

describe('convertDBMLtoDrizzle baseline coverage', () => {
  it('should convert coverage.dbml without throwing', () => {
    expect(() => convertDBMLtoDrizzle(dbmlCode1)).not.toThrow();
  });

  it('should convert coverage2.dbml without throwing', () => {
    expect(() => convertDBMLtoDrizzle(dbmlCode2)).not.toThrow();
  });

  it('output should contain definitions for all tables in coverage.dbml', () => {
    const output = convertDBMLtoDrizzle(dbmlCode1);
    expect(output).toContain('export const users');
    expect(output).toContain('export const profiles');
    expect(output).toContain('export const orders');
    expect(output).toContain('export const composite_test');
  });

  it('output should contain definitions for all tables in coverage2.dbml', () => {
    const output = convertDBMLtoDrizzle(dbmlCode2);
    expect(output).toContain('export const users');
    expect(output).toContain('export const profiles');
    expect(output).toContain('export const roles_map');
    expect(output).toContain('export const orders');
    expect(output).toContain('export const order_items');
    expect(output).toContain('export const products');
    expect(output).toContain('export const composite_test');
  });

  it('should handle both files together', () => {
    const output1 = convertDBMLtoDrizzle(dbmlCode1);
    const output2 = convertDBMLtoDrizzle(dbmlCode2);

    expect(output1).toBeTruthy();
    expect(output2).toBeTruthy();
    expect(output1).not.toBe(output2);
  });
});
