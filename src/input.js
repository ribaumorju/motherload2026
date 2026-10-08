/**
 * Keyboard, pointer and touch, reduced to one object.
 *
 * The sim only ever sees `{ left, right, up, down, drill }`. Everything about
 * which key does what lives here, including the awkward parts:
 *
 *   - keys are tracked by `event.code`, so WASD works on an AZERTY keyboard
 *     where the letter keys are in different places but the *key* is not;
 *   - held keys are released when the window loses focus, because a browser
 *     does not deliver the keyup for a key held while you alt-tab away, and the
 *     ship would otherwise fly into a wall forever;
 *   - touch uses a floating stick and a drill zone, because there is no
 *     keyboard on a phone and this game is played on a phone.
 */

const BINDINGS = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'drill', ShiftLeft: 'drill', ShiftRight: 'drill', KeyJ: 'drill',
  KeyE: 'use',
  Escape: 'pause',
  Tab: 'map',
  KeyM: 'mute',
  KeyH: 'help',
  Digit1: 'item1',
  Digit2: 'item2',
  Digit3: 'item3',
  Digit4: 'item4',
  Digit5: 'item5',
  Digit6: 'item6',
};

export function createInput(target = globalThis) {
  const held = { left: 0, right: 0, up: 0, down: 0, drill: 0 };
  /** Edge-triggered actions, drained once per frame by the game loop. */
  const pressed = new Set();
  const listeners = [];

  const on = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    listeners.push(() => el.removeEventListener(type, fn, opts));
  };

  on(target, 'keydown', (event) => {
    const action = BINDINGS[event.code];
    if (!action) return;
    // Space scrolls, Tab moves focus, arrows scroll: none of that is wanted.
    if (event.code === 'Space' || event.code === 'Tab' || event.code.startsWith('Arrow')) {
      event.preventDefault();
    }
    if (event.repeat) return;
    if (action in held) held[action] = 1;
    else pressed.add(action);
  });

  on(target, 'keyup', (event) => {
    const action = BINDINGS[event.code];
    if (!action) return;
    if (action in held) held[action] = 0;
  });

  // A key held while the window loses focus never gets its keyup.
  on(target, 'blur', () => {
    for (const key of Object.keys(held)) held[key] = 0;
    touch.active = false;
    touch.drill = false;
  });

  /* ---------------- touch ---------------- */

  const touch = {
    active: false,
    originX: 0,
    originY: 0,
    dx: 0,
    dy: 0,
    drill: false,
    stickId: null,
    drillId: null,
  };

  const DEADZONE = 12;

  /**
   * Two zones: anywhere on the left half is a floating stick that appears where
   * you press, and anywhere on the right half drills. A fixed stick is easier to
   * draw but worse to use, because your thumb does not land where you left it.
   */
  on(target, 'pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    const onUi = event.target && event.target.closest
      && event.target.closest('button, .modal, .panel, .dock');
    if (onUi) return;
    const leftHalf = event.clientX < target.innerWidth / 2;
    if (leftHalf && touch.stickId === null) {
      touch.stickId = event.pointerId;
      touch.originX = event.clientX;
      touch.originY = event.clientY;
      touch.dx = 0;
      touch.dy = 0;
      touch.active = true;
    } else if (!leftHalf && touch.drillId === null) {
      touch.drillId = event.pointerId;
      touch.drill = true;
    }
    event.preventDefault();
  }, { passive: false });

  on(target, 'pointermove', (event) => {
    if (event.pointerId !== touch.stickId) return;
    touch.dx = event.clientX - touch.originX;
    touch.dy = event.clientY - touch.originY;
  });

  const endTouch = (event) => {
    if (event.pointerId === touch.stickId) {
      touch.stickId = null;
      touch.dx = 0;
      touch.dy = 0;
      touch.active = false;
    }
    if (event.pointerId === touch.drillId) {
      touch.drillId = null;
      touch.drill = false;
    }
  };
  on(target, 'pointerup', endTouch);
  on(target, 'pointercancel', endTouch);

  /** The state the sim gets. Merges keyboard and touch without double-counting. */
  function read() {
    return {
      left: held.left || (touch.dx < -DEADZONE ? 1 : 0),
      right: held.right || (touch.dx > DEADZONE ? 1 : 0),
      up: held.up || (touch.dy < -DEADZONE ? 1 : 0),
      down: held.down || (touch.dy > DEADZONE ? 1 : 0),
      drill: held.drill || touch.drill ? 1 : 0,
    };
  }

  /** Returns true once per press. */
  function consume(action) {
    if (!pressed.has(action)) return false;
    pressed.delete(action);
    return true;
  }

  function clear() {
    pressed.clear();
    for (const key of Object.keys(held)) held[key] = 0;
    touch.drill = false;
    touch.dx = 0;
    touch.dy = 0;
  }

  function destroy() {
    for (const off of listeners) off();
    listeners.length = 0;
  }

  return { read, consume, clear, destroy, touch, held };
}
