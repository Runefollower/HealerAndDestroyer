import { describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import { transientDisplayDestroyOptions } from "./renderWorld.js";

describe("transientDisplayDestroyOptions", () => {
  it("frees the GraphicsContext of nested per-frame Graphics", () => {
    const parent = new Container();
    const graphics = new Graphics();
    graphics.circle(0, 0, 4).fill(0xffffff);
    parent.addChild(graphics);
    const context = graphics.context;

    parent.destroy(transientDisplayDestroyOptions);

    // Pixi v8 keeps the owned context alive for option-object destroys unless `context: true` is set,
    // which leaked several MB of geometry per second in the render loop.
    expect(context.destroyed).toBe(true);
  });

  it("documents why the context flag is needed", () => {
    const parent = new Container();
    const graphics = new Graphics();
    graphics.circle(0, 0, 4).fill(0xffffff);
    parent.addChild(graphics);
    const context = graphics.context;

    parent.destroy({ children: true, texture: false, textureSource: false });

    expect(context.destroyed).toBe(false);
  });
});
