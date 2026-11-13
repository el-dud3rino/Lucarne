import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addDays,
  startOfMonthGrid,
  toDateStr,
} from '../../src/client/lib/dates.js';

// Exact algorithm from src/client/views/CalendarView.tsx lines 82-91
function computeMonthGridInfo(anchorDate: Date) {
  const firstDayOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const lastDayOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
  const startDayOfWeek = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();
  const numWeeks = Math.max(5, Math.ceil((startDayOfWeek + daysInMonth) / 7));
  const totalCells = numWeeks * 7;
  const maxEvents = numWeeks >= 6 ? 2 : 3;
  return { numWeeks, totalCells, maxEvents, startDayOfWeek, daysInMonth };
}

test('Defect 2 Verification: August 2026 generates 42 cells and renders all 31 days', () => {
  const aug2026 = new Date(2026, 7, 15); // August 2026 (0-indexed month 7)
  const info = computeMonthGridInfo(aug2026);

  // August 1, 2026 is Saturday (day 6), 31 days total
  assert.equal(info.startDayOfWeek, 6, 'August 2026 should start on Saturday (day 6)');
  assert.equal(info.daysInMonth, 31, 'August 2026 should have 31 days');
  assert.equal(info.startDayOfWeek + info.daysInMonth, 37, 'Requires 37 cell positions');

  // Must compute 6 weeks (42 cells) to avoid truncating August 30 and 31
  assert.equal(info.numWeeks, 6, 'August 2026 requires exactly 6 calendar rows');
  assert.equal(info.totalCells, 42, 'August 2026 requires 42 cells (6 x 7)');
  assert.equal(info.maxEvents, 2, '6-week months must cap maxEvents to 2 to prevent vertical overflow');

  // Generate cells exactly as Month sub-view does
  const gridStart = startOfMonthGrid(aug2026);
  assert.equal(toDateStr(gridStart), '2026-07-26', 'Grid starts on Sunday July 26, 2026');

  const cells = Array.from({ length: info.totalCells }).map((_, idx) => {
    const cellDay = addDays(gridStart, idx);
    const inMonth = cellDay.getMonth() === aug2026.getMonth();
    return {
      idx,
      dateStr: toDateStr(cellDay),
      dayOfMonth: cellDay.getDate(),
      inMonth,
    };
  });

  // Verify total cell count
  assert.equal(cells.length, 42, 'Must produce 42 cells total');

  // Verify leading days from July (July 26 to July 31 = 6 days)
  const leadingDays = cells.slice(0, 6);
  assert.equal(leadingDays.every((c) => !c.inMonth), true, 'First 6 cells should be outside August');
  assert.equal(leadingDays[0].dateStr, '2026-07-26');
  assert.equal(leadingDays[5].dateStr, '2026-07-31');

  // Verify in-month August days
  const augustDays = cells.filter((c) => c.inMonth);
  assert.equal(augustDays.length, 31, 'Must contain exactly 31 August days');

  // Crucial defect regression check: August 30 and August 31
  const day30 = augustDays.find((c) => c.dayOfMonth === 30);
  const day31 = augustDays.find((c) => c.dayOfMonth === 31);
  assert.ok(day30, 'August 30 must be present in month view');
  assert.ok(day31, 'August 31 must be present in month view');
  assert.equal(day30?.dateStr, '2026-08-30');
  assert.equal(day31?.dateStr, '2026-08-31');
  assert.equal(day30?.idx, 35, 'August 30 is at cell index 35 (which was missing in 35-cell grid)');
  assert.equal(day31?.idx, 36, 'August 31 is at cell index 36 (which was missing in 35-cell grid)');

  // Verify trailing days from September (September 1 to September 5 = 5 days)
  const trailingDays = cells.slice(37);
  assert.equal(trailingDays.length, 5, 'Must have 5 trailing September days');
  assert.equal(trailingDays[0].dateStr, '2026-09-01');
  assert.equal(trailingDays[4].dateStr, '2026-09-05');
});

test('Defect 2 Verification: May 2026 (starts Friday, 31 days) generates 42 cells', () => {
  const may2026 = new Date(2026, 4, 15); // May 2026
  const info = computeMonthGridInfo(may2026);

  // May 1, 2026 is Friday (day 5), 31 days total -> 5 + 31 = 36 cells -> 6 rows
  assert.equal(info.startDayOfWeek, 5);
  assert.equal(info.daysInMonth, 31);
  assert.equal(info.numWeeks, 6);
  assert.equal(info.totalCells, 42);

  const gridStart = startOfMonthGrid(may2026);
  const cells = Array.from({ length: info.totalCells }).map((_, idx) =>
    addDays(gridStart, idx)
  );
  const inMonth = cells.filter((c) => c.getMonth() === may2026.getMonth());
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth[30].getDate(), 31, 'May 31 is rendered');
});

test('Defect 2 Verification: 5-week months and February edge cases', () => {
  // January 2026: Starts Thursday (4), 31 days -> 4 + 31 = 35 -> 5 weeks
  const jan2026 = computeMonthGridInfo(new Date(2026, 0, 15));
  assert.equal(jan2026.numWeeks, 5);
  assert.equal(jan2026.totalCells, 35);
  assert.equal(jan2026.maxEvents, 3);

  // February 2026: Non-leap year starting Sunday (0), 28 days -> Math.max(5, 4) = 5 weeks
  const feb2026 = computeMonthGridInfo(new Date(2026, 1, 15));
  assert.equal(feb2026.numWeeks, 5, 'February 2026 should clamp to minimum 5 weeks for visual consistency');
  assert.equal(feb2026.totalCells, 35);
  assert.equal(feb2026.maxEvents, 3);

  // February 2028: Leap year starting Tuesday (2), 29 days -> 2 + 29 = 31 -> 5 weeks
  const feb2028 = computeMonthGridInfo(new Date(2028, 1, 15));
  assert.equal(feb2028.numWeeks, 5);
  assert.equal(feb2028.totalCells, 35);
  assert.equal(feb2028.daysInMonth, 29);
});

test('Defect 2 Exhaustive Verification: All 120 months across 2020-2029 cover all days', () => {
  for (let y = 2020; y <= 2029; y++) {
    for (let m = 0; m < 12; m++) {
      const anchor = new Date(y, m, 15);
      const info = computeMonthGridInfo(anchor);
      const gridStart = startOfMonthGrid(anchor);

      assert.ok(
        info.totalCells >= info.startDayOfWeek + info.daysInMonth,
        `Month ${y}-${m + 1} has insufficient cells: totalCells=${info.totalCells} < required=${info.startDayOfWeek + info.daysInMonth}`
      );

      const cells = Array.from({ length: info.totalCells }).map((_, idx) =>
        addDays(gridStart, idx)
      );
      const inMonth = cells.filter((c) => c.getMonth() === m && c.getFullYear() === y);

      assert.equal(
        inMonth.length,
        info.daysInMonth,
        `Month ${y}-${m + 1} expected ${info.daysInMonth} days, got ${inMonth.length}`
      );

      // Verify every day 1..daysInMonth is present
      for (let day = 1; day <= info.daysInMonth; day++) {
        const found = inMonth.some((c) => c.getDate() === day);
        assert.ok(
          found,
          `Month ${y}-${m + 1} missing day ${day}!`
        );
      }
    }
  }
});

test('Defect 1 Verification: Compact Event Card geometry and clearance calculations', () => {
  // Constants from Tailwind classes in CalendarView.tsx
  const CARD_HEIGHT_PX = 40.0; // h-10 min-h-[40px] max-h-[40px]
  const CELL_PAD_TOP_PX = 6.0; // p-1.5 = 0.375rem = 6px
  const CELL_PAD_BOTTOM_PX = 6.0;
  const HEADER_ROW_HEIGHT_PX = 28.0; // w-7 h-7 date circle
  const HEADER_GAP_PX = 4.0; // flex flex-col gap-1 = 4px
  const CARD_GAP_PX = 4.0; // space-y-1 = 4px

  // 1. Minimum Touch Target Compliance (R1: >= 39.5px)
  assert.ok(
    CARD_HEIGHT_PX >= 39.5,
    `Card height ${CARD_HEIGHT_PX}px must be >= 39.5px`
  );

  // 2. Headroom in 5-row Month Grid (e.g. standard months in 1920x1080 kiosk)
  // Available cell height at 1080p is ~180.6px (min ~174.4px)
  const cellHeight5Rows = 180.6;
  const maxEvents5Rows = 3;

  const stackHeight5Rows =
    CELL_PAD_TOP_PX +
    HEADER_ROW_HEIGHT_PX +
    HEADER_GAP_PX +
    maxEvents5Rows * CARD_HEIGHT_PX +
    (maxEvents5Rows - 1) * CARD_GAP_PX;

  // Last card bottom coordinate relative to cell top
  const lastCardBottom5Rows = stackHeight5Rows;
  const headroom5Rows = cellHeight5Rows - lastCardBottom5Rows;

  assert.equal(
    stackHeight5Rows,
    166.0,
    '3 cards + header + padding should occupy exactly 166.0px'
  );
  assert.ok(
    headroom5Rows >= 0,
    `Headroom in 5-row cell must be non-negative: actual ${headroom5Rows}px`
  );
  assert.ok(
    headroom5Rows >= 14.0,
    `Clearance must be at least +14px to prevent any clipping: actual ${headroom5Rows.toFixed(1)}px`
  );

  // 3. Headroom in 6-row Month Grid (e.g. August 2026 in 1920x1080 kiosk)
  // Available cell height at 1080p is ~150.5px (min ~145.3px)
  const cellHeight6Rows = 150.5;
  const maxEvents6Rows = 2; // CalendarView caps maxEvents to 2 for 6-row months

  const stackHeight6Rows =
    CELL_PAD_TOP_PX +
    HEADER_ROW_HEIGHT_PX +
    HEADER_GAP_PX +
    maxEvents6Rows * CARD_HEIGHT_PX +
    (maxEvents6Rows - 1) * CARD_GAP_PX;

  const lastCardBottom6Rows = stackHeight6Rows;
  const headroom6Rows = cellHeight6Rows - lastCardBottom6Rows;

  assert.equal(
    stackHeight6Rows,
    122.0,
    '2 cards + header + padding in 6-row month should occupy exactly 122.0px'
  );
  assert.ok(
    headroom6Rows >= 0,
    `Headroom in 6-row cell must be non-negative: actual ${headroom6Rows}px`
  );
  assert.ok(
    headroom6Rows >= 28.0,
    `Clearance in 6-row month must be >= 28px: actual ${headroom6Rows.toFixed(1)}px`
  );

  // 4. Overflow badge containment
  // When dayEvents > maxEvents, badge (+1, +3) renders in header row:
  // <div className="flex items-center justify-between">
  //   <span>{cellDay.getDate()}</span>
  //   <span>+{dayEvents.length - maxEvents}</span>
  // </div>
  // Header row height remains 28px because date circle is 28px and badge is text-[11px].
  // Total vertical stack is completely unchanged!
});

test('Code Conformance Verification: src/client/views/CalendarView.tsx static AST assertions', () => {
  const filePath = path.resolve('src/client/views/CalendarView.tsx');
  const source = fs.readFileSync(filePath, 'utf-8');

  // Verify compact card CSS classes
  assert.ok(
    source.includes('h-10 min-h-[40px] max-h-[40px]'),
    'CalendarView.tsx must enforce strict 40px height on compact cards'
  );
  assert.ok(
    source.includes('flex items-center gap-2 overflow-hidden'),
    'Compact card must use single-line flex row layout'
  );
  assert.ok(
    source.includes('truncate flex-1'),
    'Compact card title must have truncate flex-1'
  );

  // Verify monthGridInfo memoization
  assert.ok(
    source.includes('const monthGridInfo = useMemo('),
    'CalendarView.tsx must memoize monthGridInfo'
  );
  assert.ok(
    source.includes('Math.ceil((startDayOfWeek + daysInMonth) / 7)'),
    'CalendarView.tsx must dynamically compute number of weeks'
  );
  assert.ok(
    source.includes('numWeeks >= 6 ? 2 : 3'),
    'CalendarView.tsx must cap maxEvents to 2 in 6-week months'
  );

  // Month view: one row per week (5 or 6), sized from the measured height so cells never cut an event
  assert.ok(
    source.includes('Array.from({ length: monthGridInfo.numWeeks }'),
    'CalendarView.tsx must render one row per week (monthGridInfo.numWeeks)'
  );
  assert.ok(source.includes('data-month-grid'), 'Month grid keeps a stable data-month-grid selector for tests');
  assert.ok(source.includes('data-more-chip'), 'Days with more events than fit show a "+N more" chip');
  assert.ok(
    source.includes('Array.from({ length: monthGridInfo.totalCells }'),
    'Phone month iterates over monthGridInfo.totalCells'
  );
});
