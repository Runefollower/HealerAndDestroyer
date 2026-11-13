import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fal } from "@fal-ai/client";

// Generates concept or sprite art through fal's hosted image models.
// The key stays local: it is read from FAL_KEY in the environment or the untracked root .env file.
// Each submit is billable, so the script never retries a request on its own.

const DEFAULT_MODEL = "fal-ai/flux/dev";
const DEFAULT_OUTPUT_DIR = join("apps", "client", "public", "assets", "generated");

const usage = `Usage: npm run generate:fal -- --prompt "<text>" [options]

Options:
  --prompt <text>   Image description (required)
  --model <id>      fal model endpoint (default ${DEFAULT_MODEL})
  --name <slug>     Output file name prefix (default: fal-<timestamp>)
  --out <dir>       Output folder (default ${DEFAULT_OUTPUT_DIR})
  --size <preset>   image_size preset such as square_hd or landscape_4_3
  --num <n>         Number of images, 1 to 4 (default 1)
  --seed <n>        Seed for repeatable results
  --input <json>    Extra model-specific input fields as a JSON object
  --help            Show this message`;

const { values: args } = parseArgs({
  options: {
    prompt: { type: "string" },
    model: { type: "string", default: DEFAULT_MODEL },
    name: { type: "string" },
    out: { type: "string", default: DEFAULT_OUTPUT_DIR },
    size: { type: "string" },
    num: { type: "string" },
    seed: { type: "string" },
    input: { type: "string" },
    help: { type: "boolean", default: false }
  }
});

if (args.help || !args.prompt) {
  console.log(usage);
  process.exit(args.help ? 0 : 1);
}

loadLocalEnv();

if (!process.env.FAL_KEY) {
  console.error("FAL_KEY is not set. Add it to the root .env file (see .env.example) or export it in your shell.");
  process.exit(1);
}

// Build the request from the shared flags first so --input can override any of them per model.
const input = { prompt: args.prompt, output_format: "png" };
if (args.size) input.image_size = args.size;
if (args.num) input.num_images = parseNonNegativeInt(args.num, "--num");
if (args.seed) input.seed = parseNonNegativeInt(args.seed, "--seed");
if (args.input) Object.assign(input, parseJsonObject(args.input));

console.log(`Submitting to ${args.model}...`);
const result = await fal.subscribe(args.model, {
  input,
  logs: true,
  onEnqueue: (requestId) => console.log(`Request id: ${requestId}`),
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      for (const log of update.logs ?? []) console.log(log.message);
    }
  }
});

const images = result.data?.images ?? (result.data?.image ? [result.data.image] : []);
if (images.length === 0) {
  console.error(`No images returned. Request id ${result.requestId}; check it in the fal dashboard before resubmitting.`);
  process.exit(1);
}

const outputDir = resolve(args.out);
mkdirSync(outputDir, { recursive: true });
const prefix = args.name ?? `fal-${new Date().toISOString().replace(/[:.]/g, "-")}`;

for (const [index, image] of images.entries()) {
  const extension = extensionFor(image.content_type);
  const suffix = images.length > 1 ? `-${index + 1}` : "";
  const filePath = join(outputDir, `${prefix}${suffix}.${extension}`);
  writeFileSync(filePath, await download(image.url));
  console.log(`Saved ${filePath}`);
}

// A sidecar records how the art was made so it can be regenerated or varied later.
const metadataPath = join(outputDir, `${prefix}.json`);
writeFileSync(
  metadataPath,
  `${JSON.stringify({ model: args.model, requestId: result.requestId, seed: result.data?.seed, input }, null, 2)}\n`
);
console.log(`Saved ${metadataPath}`);

// Loads the root .env without overriding variables already exported in the shell.
function loadLocalEnv() {
  const envPath = resolve(".env");
  if (!process.env.FAL_KEY && existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

function parseNonNegativeInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`${flag} must be a non-negative integer.`);
    process.exit(1);
  }
  return parsed;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to the shared error below.
  }
  console.error("--input must be a JSON object, for example '{\"guidance_scale\":4}'.");
  process.exit(1);
}

async function download(url) {
  // Data URIs come back when a model runs with sync_mode; hosted URLs need a fetch.
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function extensionFor(contentType) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/svg+xml") return "svg";
  return "png";
}
