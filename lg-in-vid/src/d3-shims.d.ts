declare module 'd3-array' {
  export function tickStep(start: number, stop: number, count: number): number;
  export function ticks(start: number, stop: number, count: number): number[];
}
declare module 'd3-scale' {
  export interface ScaleLinear {
    (value: number): number;
    domain(d: [number, number]): this;
    range(r: [number, number]): this;
    invert?(value: number): number;
  }
  export function scaleLinear(): ScaleLinear;
}
