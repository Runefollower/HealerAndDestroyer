export interface InputState {
  // Movement keys are sampled each ticker frame and sent as authoritative server input.
  thrustForward: boolean;
  thrustReverse: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  // Action flags track held controls for weapon, mining, and support modules.
  firePrimary: boolean;
  activateUtility: boolean;
  activateSupport: boolean;
}

// Creates the mutable input object shared by DOM event handlers and the Pixi ticker loop.
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

// Registers browser input handlers and mutates the shared InputState as controls are pressed/released.
export function attachInputListeners(input: InputState): void {
  // Keyboard input owns movement, primary fire, and builder interaction.
  window.addEventListener("keydown", (event) => {
    if (event.key === "w") input.thrustForward = true;
    if (event.key === "s") input.thrustReverse = true;
    if (event.key === "a") input.rotateLeft = true;
    if (event.key === "d") input.rotateRight = true;
    if (event.key === "e" && !event.repeat) window.dispatchEvent(new CustomEvent("builder-interact"));
    if (event.code === "Space") {
      event.preventDefault();
      input.firePrimary = true;
    }
  });

  // Keyup clears held movement/action flags so the ticker stops sending that input.
  window.addEventListener("keyup", (event) => {
    if (event.key === "w") input.thrustForward = false;
    if (event.key === "s") input.thrustReverse = false;
    if (event.key === "a") input.rotateLeft = false;
    if (event.key === "d") input.rotateRight = false;
    if (event.code === "Space") {
      event.preventDefault();
      input.firePrimary = false;
    }
  });

  // Prevent the browser context menu from stealing right-click mining input.
  window.addEventListener("contextmenu", (event) => event.preventDefault());

  // Mouse buttons activate support/mining unless the pointer is over UI chrome.
  window.addEventListener("mousedown", (event) => {
    if (isUiTarget(event.target)) {
      return;
    }

    if (event.button === 0) {
      input.activateSupport = true;
    }
    if (event.button === 2) {
      input.activateUtility = true;
    }
  });

  // Mouseup clears held module activation flags even if the pointer has moved off the canvas.
  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
      input.activateSupport = false;
    }
    if (event.button === 2) {
      input.activateUtility = false;
    }
  });
}

// Detects UI targets that should receive clicks without triggering world actions.
function isUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("#builder, #hud, #notifications, button");
}
