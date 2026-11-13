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

## Rock terrain sprites

The common rock variants (`apps/client/public/assets/terrain/rock/rock-01..64.png`) are cut from a fal-generated rubble texture saved in `art-source/terrain/rock-texture-01.png`. Its `.json` sidecar records the prompt and seed.

```bash
npm run generate:rock-from-texture
```

The script takes a seeded 448px crop of the texture for each variant and box-filters it down to 64px. It keeps the alpha silhouette of the existing sprite, so walls still overlap and blend the same way in the renderer. It is deterministic, so rerunning it with the same texture and seed gives identical files. To restyle the rocks, generate a new full-frame texture (the prompt in the sidecar is a good starting point), save it under `art-source/terrain/`, and pass `--texture <path>`.

Prompt lessons learned: words like "cave" or "tile" make FLUX compose a clearing or a frame in the middle. A "uniform rubble field photographed straight down, no clearing, no center focus" prompt gives even full-frame coverage.
