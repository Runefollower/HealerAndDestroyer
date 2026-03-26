export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec2i {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function addVec2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scaleVec2(value: Vec2, scalar: number): Vec2 {
  return { x: value.x * scalar, y: value.y * scalar };
}

export function magnitude(value: Vec2): number {
  return Math.hypot(value.x, value.y);
}

export function normalize(value: Vec2): Vec2 {
  const length = magnitude(value);
  return length === 0 ? vec2() : scaleVec2(value, 1 / length);
}

export function distance(a: Vec2, b: Vec2): number {
  return magnitude({ x: a.x - b.x, y: a.y - b.y });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

