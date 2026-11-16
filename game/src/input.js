// input.js — keyboard and mouse state, with pointer lock.
//
// One shared object the player controller and menus read. `pressed` holds
// key codes for exactly one consumption (edge detection for buys, jumps and
// semi-auto fire); `keys` holds everything currently down. Mouse look deltas
// accumulate between frames and are consumed by player.js.

export const input = {
  keys: new Set(),
  pressed: new Set(),
  mouseDown: false,
  mouseClicked: false,
  mouseRDown: false,
  lookDX: 0,
  lookDY: 0,
  locked: false,
};

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (['Space', 'Tab', 'ControlLeft'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.mouseDown = false;
    input.mouseRDown = false;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      input.mouseDown = true;
      input.mouseClicked = true;
    }
    if (e.button === 2) input.mouseRDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
    if (e.button === 2) input.mouseRDown = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  });
}

export function lockPointer(canvas) {
  if (!input.locked) canvas.requestPointerLock();
}

export function wasPressed(code) {
  if (input.pressed.has(code)) {
    input.pressed.delete(code);
    return true;
  }
  return false;
}

export function consumeLook() {
  const dx = input.lookDX;
  const dy = input.lookDY;
  input.lookDX = 0;
  input.lookDY = 0;
  return { dx, dy };
}
