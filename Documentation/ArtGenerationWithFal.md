# Generating art with fal

`scripts/generate-fal-image.mjs` sends a prompt to one of [fal](https://fal.ai)'s hosted image models and saves the result, plus a `.json` sidecar with the model, input, seed and request id so an image can be regenerated or varied later.

## Setup

1. Get a fal API key at <https://fal.ai/dashboard/keys> (API preset), or approve one through fal's agent connect flow.
2. Copy `.env.example` to `.env` in the repo root and set `FAL_KEY=...`. `.env` is git-ignored; never commit the key or put it in client code.
3. Add credits or a payment method in the fal dashboard. A `403 Exhausted balance` error means the account needs credits.

## Usage

```bash
npm run generate:fal -- --prompt "top-down sci-fi mining ship, dark background, game sprite" --size square_hd --name ship-miner
```

Images land in `apps/client/public/assets/generated/` unless `--out` says otherwise. Other models work through `--model <endpoint>` and `--input '<json>'` for their own fields; check each model's schema on its fal page first.

Every submit is billable (FLUX dev is about $0.025 per megapixel), so the script never retries on its own. If a run fails after printing a request id, look it up in the fal dashboard before resubmitting.

## Terrain sprites

All five solid terrain materials (`apps/client/public/assets/terrain/<material>/<material>-01..64.png`) are cut from fal-generated full-frame textures in `art-source/terrain/<material>-texture-01.png`. Each texture has a `.json` sidecar that records its prompt and seed.

```bash
npm run generate:terrain                    # all materials
npm run generate:terrain -- --only ferrite-ore
```

`scripts/build-terrain-sprites-from-texture.mjs` takes a seeded crop of the texture for each variant and box-filters it down to 64px. Every material uses the alpha silhouettes of the common rock sprites, so walls overlap and blend the same way in the renderer. The output is deterministic. To restyle a material, generate a new full-frame texture, save it over the source file, and rerun the command. The old procedural generator is still available as `npm run generate:terrain-procedural`, but it overwrites the non-rock materials.

Prompt lessons: words like "cave" or "tile" make FLUX compose a clearing or a frame in the middle. "Uniform repeating pattern of tightly packed ... covering 100 percent of the image, photographed straight down, no clearing, no center focus" gives even full-frame coverage.

## Ship, enemy, structure and salvage sprites

Source art lives in `art-source/sprites/<id>.png`: transparent, trimmed, high resolution, with a `.json` sidecar for the prompt and seed. `art-source/sprites/manifest.json` maps each source to its game file, its world-space size and a rotation. The art is generated nose-up and rotated so it faces +x, the game's forward direction.

```bash
npm run generate:sprites                    # rebuild every sprite
npm run generate:sprites -- --only hull-sparrow-dart
```

The build trims the art, fits it centered into width x height x `scale` (4x), and writes PNGs that `playerShipAssets.ts` and `worldEntityAssets.ts` load at the same world sizes as before.

To make a new sprite, generate candidates with a background cutout and pick one:

```bash
npm run generate:fal -- --remove-bg --num 4 --size square_hd --name hull-new --prompt "<subject>, nose pointing straight up toward the top of the image. Top-down view from directly above, orthographic, flat 2D game sprite for a sci-fi cave shooter, crisp clean silhouette, polished hand-painted sci-fi style with subtle panel lines, soft light from the top-left, centered and fully visible with margin around it, isolated on a plain flat light grey background, no cast shadow, no text, no frame"
```

`--remove-bg` runs each image through `fal-ai/birefnet/v2` and saves a `-cutout.png` next to it. Copy the chosen cutout into `art-source/sprites/`, add a manifest entry, and run `npm run generate:sprites`. For engine parts, avoid the words "engine" and "nozzle" with "rocket" framing: FLUX tends to draw whole rockets with flames.
