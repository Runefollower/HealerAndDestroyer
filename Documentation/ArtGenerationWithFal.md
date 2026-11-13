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
