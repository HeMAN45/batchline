import { CONTRACT } from '../app/engine.js';
import { compare } from '../app/demo.js';

console.table(compare(CONTRACT).map(row => ({
  policy: row.name,
  detection: (row.detection * 100).toFixed(1) + '%',
  precision: (row.precision * 100).toFixed(1) + '%',
  recovery: (row.recovery * 100).toFixed(1) + '%',
  falseEdits: row.falseEdits,
  quarantined: row.held,
  reviewQueue: row.review,
  revenueError: row.revenueError.toFixed(2)
})));
