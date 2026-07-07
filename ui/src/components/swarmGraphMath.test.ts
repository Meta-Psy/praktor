import { expect, test } from 'vitest';
import {
  applyPan, applyPinch, applyWheelZoom, clampScale, toGraphPoint,
  MIN_SCALE, MAX_SCALE,
} from './swarmGraphMath';

test('clampScale ограничивает диапазон', () => {
  expect(clampScale(0.01)).toBe(MIN_SCALE);
  expect(clampScale(10)).toBe(MAX_SCALE);
  expect(clampScale(1)).toBe(1);
});

test('toGraphPoint обращает translate+scale', () => {
  const view = { x: 40, y: -20, scale: 2 };
  expect(toGraphPoint(view, { x: 240, y: 180 })).toEqual({ x: 100, y: 100 });
});

test('applyPan сдвигает вид на дельту экрана', () => {
  expect(applyPan({ x: 10, y: 10, scale: 1 }, 5, -3)).toEqual({ x: 15, y: 7, scale: 1 });
});

test('applyWheelZoom: точка под курсором остаётся на месте', () => {
  const view = { x: 0, y: 0, scale: 1 };
  const cursor = { x: 100, y: 50 };
  const out = applyWheelZoom(view, cursor, -100); // deltaY<0 — зум-ин
  expect(out.scale).toBeGreaterThan(1);
  const before = toGraphPoint(view, cursor);
  const after = toGraphPoint(out, cursor);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});

test('applyPinch: раздвигание пальцев зумит, центр пинча неподвижен', () => {
  const view = { x: 0, y: 0, scale: 1 };
  const prev1 = { x: 90, y: 100 };
  const prev2 = { x: 110, y: 100 };
  const p1 = { x: 80, y: 100 };
  const p2 = { x: 120, y: 100 };
  const out = applyPinch(view, prev1, prev2, p1, p2);
  expect(out.scale).toBeCloseTo(2);
  const before = toGraphPoint(view, { x: 100, y: 100 });
  const after = toGraphPoint(out, { x: 100, y: 100 });
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});

test('applyPinch с нулевой прошлой дистанцией не меняет вид', () => {
  const view = { x: 5, y: 5, scale: 1.5 };
  const p = { x: 100, y: 100 };
  expect(applyPinch(view, p, p, { x: 90, y: 100 }, { x: 110, y: 100 })).toEqual(view);
});
