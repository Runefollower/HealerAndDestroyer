import "@fontsource/orbitron/500.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import { bootstrapClient } from "./game/app.js";

// Boot the browser client and surface startup failures in the HUD instead of failing silently.
bootstrapClient().catch((error) => {
  const hud = document.getElementById("hud");
  if (hud) {
    hud.innerHTML = `<strong>Client failed to boot:</strong> ${String(error)}`;
  }
});
