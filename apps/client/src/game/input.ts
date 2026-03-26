export interface InputState {
  thrustForward: boolean;
  thrustReverse: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  firePrimary: boolean;
}

export function createInputState(): InputState {
  return {
    thrustForward: false,
    thrustReverse: false,
    rotateLeft: false,
    rotateRight: false,
    firePrimary: false
  };
}

export function attachInputListeners(input: InputState): void {
  window.addEventListener("keydown", (event) => {
    if (event.key === "w") input.thrustForward = true;
    if (event.key === "s") input.thrustReverse = true;
    if (event.key === "a") input.rotateLeft = true;
    if (event.key === "d") input.rotateRight = true;
    if (event.key === "e") window.dispatchEvent(new CustomEvent("builder-interact"));
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "w") input.thrustForward = false;
    if (event.key === "s") input.thrustReverse = false;
    if (event.key === "a") input.rotateLeft = false;
    if (event.key === "d") input.rotateRight = false;
  });

  window.addEventListener("mousedown", () => {
    input.firePrimary = true;
  });

  window.addEventListener("mouseup", () => {
    input.firePrimary = false;
  });
}

