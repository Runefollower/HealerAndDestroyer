import { bootstrapClient } from "./game/app.js";

bootstrapClient().catch((error) => {
  const hud = document.getElementById("hud");
  if (hud) {
    hud.innerHTML = `<strong>Client failed to boot:</strong> ${String(error)}`;
  }
});
