/**
 * Icons and the level bar, drawn with canvas paths (the panel's fonts have
 * no emoji). Every icon fits the square (x, y, s) and is stroked in `color`.
 */
import type { Graphics } from '@kiosko/sdk';
import type { Kind } from './types.ts';

function rr(g: Graphics, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y);
  g.lineTo(x + w - k, y);
  g.arcTo(x + w, y, x + w, y + k, k);
  g.lineTo(x + w, y + h - k);
  g.arcTo(x + w, y + h, x + w - k, y + h, k);
  g.lineTo(x + k, y + h);
  g.arcTo(x, y + h, x, y + h - k, k);
  g.lineTo(x, y + k);
  g.arcTo(x, y, x + k, y, k);
  g.closePath();
}

export function drawKindIcon(g: Graphics, kind: Kind, x: number, y: number, s: number, color: string): void {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = Math.max(1.2, s * 0.09);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const u = s / 24; // drawn on a 24-unit grid
  const X = (v: number) => x + v * u;
  const Y = (v: number) => y + v * u;
  switch (kind) {
    case 'headset': {
      g.beginPath();
      g.arc(X(12), Y(13), 8 * u, Math.PI, 0);
      g.stroke();
      rr(g, X(3), Y(13), 4.5 * u, 7 * u, 1.5 * u);
      g.fill();
      rr(g, X(16.5), Y(13), 4.5 * u, 7 * u, 1.5 * u);
      g.fill();
      break;
    }
    case 'mouse': {
      rr(g, X(6.5), Y(2.5), 11 * u, 19 * u, 5.5 * u);
      g.stroke();
      g.beginPath();
      g.moveTo(X(12), Y(5.5));
      g.lineTo(X(12), Y(9));
      g.stroke();
      break;
    }
    case 'keyboard': {
      rr(g, X(1.5), Y(6), 21 * u, 12 * u, 2 * u);
      g.stroke();
      const d = Math.max(1, 1.6 * u);
      for (const row of [9.5, 12.5])
        for (let c = 5; c <= 19; c += 3.5) g.fillRect(X(c) - d / 2, Y(row) - d / 2, d, d);
      g.beginPath();
      g.moveTo(X(7.5), Y(15.3));
      g.lineTo(X(16.5), Y(15.3));
      g.stroke();
      break;
    }
    case 'gamepad': {
      g.beginPath();
      g.moveTo(X(7), Y(6.5));
      g.lineTo(X(17), Y(6.5));
      g.bezierCurveTo(X(21), Y(6.5), X(23), Y(16), X(22), Y(18.5));
      g.bezierCurveTo(X(21), Y(20.5), X(18.5), Y(19.5), X(16.5), Y(16));
      g.lineTo(X(7.5), Y(16));
      g.bezierCurveTo(X(5.5), Y(19.5), X(3), Y(20.5), X(2), Y(18.5));
      g.bezierCurveTo(X(1), Y(16), X(3), Y(6.5), X(7), Y(6.5));
      g.closePath();
      g.stroke();
      g.beginPath();
      g.moveTo(X(5.5), Y(11));
      g.lineTo(X(9.5), Y(11));
      g.moveTo(X(7.5), Y(9));
      g.lineTo(X(7.5), Y(13));
      g.stroke();
      g.beginPath();
      g.arc(X(16), Y(10), 1.1 * u, 0, Math.PI * 2);
      g.arc(X(18.5), Y(12.3), 1.1 * u, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'phone': {
      rr(g, X(6.5), Y(2), 11 * u, 20 * u, 2.5 * u);
      g.stroke();
      g.beginPath();
      g.moveTo(X(10.5), Y(18.5));
      g.lineTo(X(13.5), Y(18.5));
      g.stroke();
      break;
    }
    case 'laptop': {
      rr(g, X(4), Y(4.5), 16 * u, 11 * u, 1.5 * u);
      g.stroke();
      g.beginPath();
      g.moveTo(X(1.5), Y(19));
      g.lineTo(X(22.5), Y(19));
      g.stroke();
      break;
    }
    case 'tablet': {
      rr(g, X(4), Y(2.5), 16 * u, 19 * u, 2 * u);
      g.stroke();
      g.beginPath();
      g.arc(X(12), Y(18.5), 0.9 * u, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'pen': {
      g.beginPath();
      g.moveTo(X(17), Y(3.5));
      g.lineTo(X(20.5), Y(7));
      g.lineTo(X(8), Y(19.5));
      g.lineTo(X(3.5), Y(20.5));
      g.lineTo(X(4.5), Y(16));
      g.closePath();
      g.stroke();
      break;
    }
    default: {
      rr(g, X(2.5), Y(7), 17 * u, 10 * u, 2 * u);
      g.stroke();
      g.fillRect(X(20.5), Y(10), 2 * u, 4 * u);
      break;
    }
  }
  g.restore();
}

/** A lightning bolt in the box (x, y, w, h), filled. */
export function drawBolt(g: Graphics, x: number, y: number, w: number, h: number, color: string): void {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x + w * 0.62, y);
  g.lineTo(x + w * 0.08, y + h * 0.58);
  g.lineTo(x + w * 0.46, y + h * 0.58);
  g.lineTo(x + w * 0.34, y + h);
  g.lineTo(x + w * 0.92, y + h * 0.4);
  g.lineTo(x + w * 0.54, y + h * 0.4);
  g.closePath();
  g.fill();
  g.restore();
}

/** The level bar: a dim track and the filled part, `level` 0..100. */
export function drawBar(g: Graphics, x: number, y: number, w: number, h: number, level: number, fill: string, track: string): void {
  const r = h / 2;
  g.save();
  g.fillStyle = track;
  rr(g, x, y, w, h, r);
  g.fill();
  const fw = Math.max(level > 0 ? h : 0, (w * Math.max(0, Math.min(100, level))) / 100);
  if (fw > 0) {
    g.fillStyle = fill;
    rr(g, x, y, fw, h, r);
    g.fill();
  }
  g.restore();
}

/** A check mark in a circle, for "all charged". */
export function drawCheck(g: Graphics, x: number, y: number, s: number, color: string): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.2, s * 0.09);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.arc(x + s / 2, y + s / 2, s * 0.42, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(x + s * 0.3, y + s * 0.52);
  g.lineTo(x + s * 0.45, y + s * 0.66);
  g.lineTo(x + s * 0.71, y + s * 0.38);
  g.stroke();
  g.restore();
}
