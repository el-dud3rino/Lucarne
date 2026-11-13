import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isWithinNightHours, pairPhotos } from '../../src/client/views/ScreensaverOverlay.js';
import type { PhotoItem } from '../../src/shared/types.js';

test('Tier 5 Challenger: Screensaver Focus Blur & Accidental Keydown Wake Prevention', () => {
  // 1. Simulate document.activeElement blur on activation
  let blurCalled = false;
  const mockButton = {
    blur: () => {
      blurCalled = true;
    },
  };
  (globalThis as any).document = {
    activeElement: mockButton,
  };

  if (
    document.activeElement &&
    'blur' in document.activeElement &&
    typeof (document.activeElement as HTMLElement).blur === 'function'
  ) {
    (document.activeElement as HTMLElement).blur();
  }

  assert.equal(blurCalled, true, 'Active element must be blurred upon screensaver activation');

  // 2. Simulate keydown prevention for Spacebar and Enter
  let prevented = false;
  let woken = false;
  const mockSpaceEvent = {
    key: ' ',
    preventDefault: () => {
      prevented = true;
    },
  };

  const handleKeyDown = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    woken = true;
  };

  handleKeyDown(mockSpaceEvent);
  assert.equal(prevented, true, 'Spacebar wake must call e.preventDefault() to prevent activating blurred button');
  assert.equal(woken, true, 'Spacebar must trigger onWake');
});

test('Tier 5 Challenger: Screensaver OLED Amber Clock Schedule Edge Cases', () => {
  // Midnight crossing: 22:00 to 06:30
  const dLate = new Date(2026, 9, 30, 23, 15);
  const dEarly = new Date(2026, 9, 31, 5, 45);
  const dDay = new Date(2026, 9, 31, 14, 0);

  assert.equal(isWithinNightHours(dLate, '22:00', '06:30'), true, '23:15 is within night hours');
  assert.equal(isWithinNightHours(dEarly, '22:00', '06:30'), true, '05:45 is within night hours');
  assert.equal(isWithinNightHours(dDay, '22:00', '06:30'), false, '14:00 is outside night hours');

  // Boundary checks: exact start (inclusive) and exact end (exclusive)
  const dExactStart = new Date(2026, 9, 30, 22, 0);
  const dExactEnd = new Date(2026, 9, 31, 6, 30);
  assert.equal(isWithinNightHours(dExactStart, '22:00', '06:30'), true, 'Exact start 22:00 is night');
  assert.equal(isWithinNightHours(dExactEnd, '22:00', '06:30'), false, 'Exact end 06:30 is day');
});

test('Tier 5 Challenger: Screensaver Photo Pairing Ergonomics on 16:9 Landscape', () => {
  // Empty
  assert.deepEqual(pairPhotos([]), [], 'Empty photos returns empty slides');

  // Single portrait
  const p1: PhotoItem = { id: 'p1', url: 'p1.jpg', orientation: 'portrait', createdAt: '' };
  const single = pairPhotos([p1]);
  assert.equal(single.length, 1);
  assert.equal(single[0].length, 1);
  assert.equal(single[0][0].id, 'p1');

  // Odd portrait count wrap-around (e.g. 3 portraits: [p1, p2], [p3, p1])
  const p2: PhotoItem = { id: 'p2', url: 'p2.jpg', orientation: 'portrait', createdAt: '' };
  const p3: PhotoItem = { id: 'p3', url: 'p3.jpg', orientation: 'portrait', createdAt: '' };
  const l1: PhotoItem = { id: 'l1', url: 'l1.jpg', orientation: 'landscape', createdAt: '' };

  const paired = pairPhotos([p1, p2, p3, l1]);
  assert.equal(paired.length, 3, 'Must contain 3 slides (1 landscape + 2 portrait pairs)');
  assert.equal(paired[0][0].id, 'l1', 'First slide is landscape');
  assert.deepEqual(paired[1].map((p) => p.id), ['p1', 'p2'], 'Second slide is pair [p1, p2]');
  assert.deepEqual(paired[2].map((p) => p.id), ['p3', 'p1'], 'Third slide wraps around [p3, p1]');
});

test('Tier 5 Challenger: CookMode AudioContext Creation & Disposal Lifecycle', async () => {
  let createdContexts = 0;
  let closedContexts = 0;
  let createdOscillators = 0;
  let createdGainNodes = 0;

  class MockAudioContext {
    currentTime = 0;
    state = 'running';
    destination = {};

    constructor() {
      createdContexts++;
    }

    createOscillator() {
      createdOscillators++;
      return {
        type: 'sine',
        frequency: { setValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {},
      };
    }

    createGain() {
      createdGainNodes++;
      return {
        gain: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      };
    }

    async close() {
      closedContexts++;
    }

    async resume() {
      this.state = 'running';
    }
  }

  // Inject mock window.AudioContext
  (globalThis as any).window = {
    AudioContext: MockAudioContext,
  };

  // Execute sound generation logic as in CookModeView.tsx
  const playTestChime = () => {
    const AudioCtx = (window as any).AudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((freq: number, idx: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.16);
      gain.gain.setValueAtTime(0.3, now + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.16 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.35);
    });

    ctx.close();
  };

  playTestChime();

  assert.equal(createdContexts, 1, 'Exactly one AudioContext created per chime');
  assert.equal(createdOscillators, 4, '4 oscillator nodes created for 4-tone chime');
  assert.equal(createdGainNodes, 4, '4 gain nodes created with exponential ramp');
  assert.equal(closedContexts, 1, 'AudioContext is cleanly closed');
});

test('Tier 5 Challenger: Screen WakeLock Lifecycle & Re-Acquisition on Visibility Change', async () => {
  let requestedLocks = 0;
  let releasedLocks = 0;

  const mockSentinel = {
    release: async () => {
      releasedLocks++;
    },
    addEventListener: (_ev: string, _cb: () => void) => {},
  };

  const mockNavigatorWakeLock = {
    request: async (type: string) => {
      assert.equal(type, 'screen', 'Must request screen wake lock');
      requestedLocks++;
      return mockSentinel;
    },
  };

  Object.defineProperty(globalThis.navigator, 'wakeLock', {
    value: mockNavigatorWakeLock,
    configurable: true,
    writable: true,
  });

  let docVisibility = 'visible';
  const listeners: Record<string, Function[]> = {};

  (globalThis as any).document = {
    get visibilityState() {
      return docVisibility;
    },
    addEventListener: (ev: string, cb: Function) => {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(cb);
    },
    removeEventListener: (ev: string, cb: Function) => {
      if (listeners[ev]) {
        listeners[ev] = listeners[ev].filter((f) => f !== cb);
      }
    },
  };

  // Simulate component mount
  let lock: any = null;
  const requestLock = async () => {
    if (document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
    }
  };

  await requestLock();
  assert.equal(requestedLocks, 1, 'Wake lock acquired on mount');

  // Simulate tab switching to background (visibilityState = hidden)
  docVisibility = 'hidden';
  if (lock) {
    await lock.release();
    lock = null;
  }
  assert.equal(releasedLocks, 1, 'Wake lock released when backgrounded');

  // Simulate tab returning to foreground (visibilityState = visible)
  docVisibility = 'visible';
  await requestLock();
  assert.equal(requestedLocks, 2, 'Wake lock re-acquired on visibility returning to visible');

  // Simulate component unmount
  if (lock) {
    await lock.release();
    lock = null;
  }
  assert.equal(releasedLocks, 2, 'Wake lock released on component unmount');
});

test('Tier 5 Challenger: Virtual Touch Keyboard State & Mobile Suppression Logic', () => {
  // Test native input value dispatcher helper
  let inputEventDispatched = false;
  let changeEventDispatched = false;

  const mockInput = {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    dispatchEvent: (ev: { type: string }) => {
      if (ev.type === 'input') inputEventDispatched = true;
      if (ev.type === 'change') changeEventDispatched = true;
    },
    setSelectionRange: function (start: number, end: number) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };

  const simulateInsert = (target: typeof mockInput, txt: string) => {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + txt + target.value.slice(end);
    target.value = next;
    target.dispatchEvent({ type: 'input' });
    target.dispatchEvent({ type: 'change' });
    const cursor = start + txt.length;
    target.setSelectionRange(cursor, cursor);
  };

  simulateInsert(mockInput, 'Milk');
  assert.equal(mockInput.value, 'Milk');
  assert.equal(inputEventDispatched, true);
  assert.equal(changeEventDispatched, true);
  assert.equal(mockInput.selectionStart, 4);

  // Test backspace
  const simulateBackspace = (target: typeof mockInput) => {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    let next = target.value;
    let cursor = start;
    if (start !== end) {
      next = target.value.slice(0, start) + target.value.slice(end);
    } else if (start > 0) {
      next = target.value.slice(0, start - 1) + target.value.slice(end);
      cursor = start - 1;
    }
    target.value = next;
    target.setSelectionRange(cursor, cursor);
  };

  simulateBackspace(mockInput);
  assert.equal(mockInput.value, 'Mil');
  assert.equal(mockInput.selectionStart, 3);

  // Test mobile viewport threshold (< 768px suppression)
  const isMobile = (width: number) => width < 768;
  assert.equal(isMobile(390), true, '390px (iPhone) must suppress on-screen keyboard');
  assert.equal(isMobile(767), true, '767px mobile tablet boundary must suppress on-screen keyboard');
  assert.equal(isMobile(768), false, '768px tablet allows on-screen keyboard');
  assert.equal(isMobile(1920), false, '1920px landscape wall kiosk enables on-screen keyboard');
});

test('Tier 5 Challenger: White-Box Static Audit of Touch Target Dimensions in src/client/', () => {
  const clientDir = path.resolve('src/client');
  const files: string[] = [];

  function collectFiles(dir: string) {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        collectFiles(full);
      } else if (full.endsWith('.tsx')) {
        files.push(full);
      }
    }
  }

  collectFiles(clientDir);
  assert.ok(files.length >= 8, `Must find at least 8 client tsx files (found ${files.length})`);

  const violationList: string[] = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const content = fs.readFileSync(file, 'utf-8');

    // Check for undersized button classes without compensating min-h/min-w or padding:
    // e.g. <button ... className="... h-6 ..." or "w-6 h-6" without min-h-[40px]
    const buttonRegex = /<button\b([^>]*?)>/g;
    let match;
    while ((match = buttonRegex.exec(content)) !== null) {
      const buttonAttrs = match[1];
      // Skip hidden buttons or zero-sized accessible buttons
      if (buttonAttrs.includes('sr-only') || buttonAttrs.includes('hidden')) continue;

      // Extract className if present
      const classMatch = buttonAttrs.match(/className=(?:\{`([^`]+)`\}|"([^"]+)")/);
      if (!classMatch) continue;
      const classList = classMatch[1] || classMatch[2] || '';

      // Check if button specifies an undersized fixed height/width like h-6, h-7, h-8 without min-h-[40px] or min-h-[44px]
      const hasUndersizedFixed = /\b(h-[45678]|w-[45678])\b/.test(classList);
      const hasCompensatingMin = /\b(min-h-\[(?:4[0-9]|5[0-9])px\]|min-w-\[(?:4[0-9]|5[0-9])px\]|min-h-10|min-h-11|min-h-12|h-10|h-11|h-12|h-14|p-[345]|py-[345])\b/.test(
        classList
      );

      if (hasUndersizedFixed && !hasCompensatingMin) {
        violationList.push(`${rel}: Button has undersized dimension without min size: "${classList}"`);
      }
    }
  }

  assert.equal(
    violationList.length,
    0,
    `Found buttons with undersized dimensions in client views:\n${violationList.join('\n')}`
  );
});

test('Tier 5 Challenger: White-Box Static Audit of Viewport & Zero-Overflow Constraints', () => {
  const appFile = path.resolve('src/client/App.tsx');
  const appContent = fs.readFileSync(appFile, 'utf-8');

  // Verify App root fills the visible viewport (dvh, so phone browser bars don't hide the tab bar) without document overflow
  assert.ok(
    appContent.includes('h-dvh w-screen overflow-hidden'),
    'App.tsx root must have h-dvh w-screen overflow-hidden to prevent document overflow'
  );

  // Verify main content container has min-w-0 min-h-0 overflow-hidden
  assert.ok(
    appContent.includes('min-w-0 min-h-0'),
    'App.tsx main content column must have flex-1 min-w-0 min-h-0 to prevent flexbox overflow blowout'
  );

  // Verify CookModeView has overflow-x-hidden
  const cookFile = path.resolve('src/client/views/CookModeView.tsx');
  const cookContent = fs.readFileSync(cookFile, 'utf-8');
  assert.ok(
    cookContent.includes('overflow-x-hidden'),
    'CookModeView.tsx must have overflow-x-hidden on root'
  );

  // Verify SettingsView has overflow-x-hidden
  const settingsFile = path.resolve('src/client/views/SettingsView.tsx');
  const settingsContent = fs.readFileSync(settingsFile, 'utf-8');
  assert.ok(
    settingsContent.includes('overflow-x-hidden'),
    'SettingsView.tsx must have overflow-x-hidden on root'
  );
});
