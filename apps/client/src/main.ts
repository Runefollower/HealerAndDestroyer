import { bootstrapClient } from "./game/app.js";

// Boot the browser client and surface startup failures in the HUD instead of failing silently.
bootstrapClient().catch((error) => {
  const hud = document.getElementById("hud");
  if (hud) {
    hud.innerHTML = `<strong>Client failed to boot:</strong> ${String(error)}`;
  }
});
