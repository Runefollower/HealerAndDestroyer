export interface InputState {
  thrustForward: boolean;
  thrustReverse: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  firePrimary: boolean;
  activateUtility: boolean;
  activateSupport: boolean;
}

export function createInputState(): InputState {
  return {
    thrustForward: false,
    thrustReverse: false,
    rotateLeft: false,
    rotateRight: false,
    firePrimary: false,
    activateUtility: false,
    activateSupport: false
  };
}

export function attachInputListeners(input: InputState): void {
  window.addEventListener("keydown", (event) => {
    if (event.key === "w") input.thrustForward = true;
    if (event.key === "s") input.thrustReverse = true;
    if (event.key === "a") input.rotateLeft = true;
    if (event.key === "d") input.rotateRight = true;
    if (event.key === "e" && !event.repeat) window.dispatchEvent(new CustomEvent("builder-interact"));
    if (event.key === " ") input.activateSupport = true;
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "w") input.thrustForward = false;
    if (event.key === "s") input.thrustReverse = false;
    if (event.key === "a") input.rotateLeft = false;
    if (event.key === "d") input.rotateRight = false;
    if (event.key === " ") input.activateSupport = false;
  });

  window.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
      input.firePrimary = true;
    }
    if (event.button === 2) {
      input.activateUtility = true;
    }
  });

  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
      input.firePrimary = false;
    }
    if (event.button === 2) {
      input.activateUtility = false;
    }
  });
}
