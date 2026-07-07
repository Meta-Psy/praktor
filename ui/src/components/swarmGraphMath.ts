// Геометрия холста редактора отрядов: вид {x, y, scale} —
// экранная точка = графовая * scale + сдвиг. Чистые функции, тестируются без DOM.

export interface ViewTransform { x: number; y: number; scale: number; }
export interface Point { x: number; y: number; }

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 2.5;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

// Экранная точка → координаты графа
export function toGraphPoint(view: ViewTransform, screen: Point): Point {
  return { x: (screen.x - view.x) / view.scale, y: (screen.y - view.y) / view.scale };
}

// Пан: дельта в экранных пикселях
export function applyPan(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

// Зум к точке: точка cursor (экранная) остаётся на месте
function zoomAround(view: ViewTransform, cursor: Point, nextScale: number): ViewTransform {
  const scale = clampScale(nextScale);
  const ratio = scale / view.scale;
  return {
    scale,
    x: cursor.x - (cursor.x - view.x) * ratio,
    y: cursor.y - (cursor.y - view.y) * ratio,
  };
}

// Колесо мыши: шаг 10%, зум вокруг курсора
export function applyWheelZoom(view: ViewTransform, cursor: Point, deltaY: number): ViewTransform {
  return zoomAround(view, cursor, view.scale * (deltaY < 0 ? 1.1 : 1 / 1.1));
}

// Пинч: prev1/prev2 — прошлые экранные позиции пальцев, p1/p2 — текущие.
// Масштаб — по отношению дистанций, центр пинча остаётся на месте.
export function applyPinch(
  view: ViewTransform,
  prev1: Point, prev2: Point,
  p1: Point, p2: Point,
): ViewTransform {
  const prevDist = Math.hypot(prev2.x - prev1.x, prev2.y - prev1.y);
  if (prevDist === 0) return view;
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const prevCenter = { x: (prev1.x + prev2.x) / 2, y: (prev1.y + prev2.y) / 2 };
  const zoomed = zoomAround(view, prevCenter, view.scale * (dist / prevDist));
  return applyPan(zoomed, center.x - prevCenter.x, center.y - prevCenter.y);
}
