import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outputDir = join(process.cwd(), "apps", "client", "public", "assets", "terrain", "rock");
const previewPath = join(outputDir, "preview.html");
const tileSize = 32;
const spriteSize = 46;
const spriteInset = (spriteSize - tileSize) / 2;
const previewColumns = 8;
const previewRows = 8;

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const variants = readdirSync(outputDir)
  .filter((entry) => /^rock-\d+\.png$/i.test(entry))
  .sort((left, right) => left.localeCompare(right));

if (!variants.length) {
  throw new Error(`No terrain rock PNGs found in ${outputDir}`);
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Terrain Rock Preview</title>
  <style>
    :root {
      color-scheme: dark;
      --page: #0f1418;
      --panel: #172028;
      --panel-border: #263441;
      --ink: #e2edf4;
      --muted: #8fa1ae;
      --checker-a: #14202a;
      --checker-b: #1b2833;
      --accent: #7fc8ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top, rgba(127, 200, 255, 0.08), transparent 26%),
        linear-gradient(180deg, #10171d 0%, var(--page) 100%);
      color: var(--ink);
      min-height: 100vh;
    }
    main {
      width: min(1320px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 28px 0 60px;
    }
    h1, h2 { margin: 0 0 10px; font-weight: 600; }
    p { margin: 0; color: var(--muted); line-height: 1.5; }
    .stack { display: grid; gap: 24px; }
    .panel {
      background: rgba(23, 32, 40, 0.9);
      border: 1px solid rgba(38, 52, 65, 0.9);
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.24);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 14px;
    }
    .sheet {
      display: grid;
      grid-template-columns: repeat(8, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }
    .tile-card { display: grid; gap: 8px; }
    .checker {
      position: relative;
      overflow: hidden;
      min-height: 108px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      background:
        linear-gradient(45deg, var(--checker-a) 25%, transparent 25%) 0 0 / 22px 22px,
        linear-gradient(-45deg, var(--checker-a) 25%, transparent 25%) 0 11px / 22px 22px,
        linear-gradient(45deg, transparent 75%, var(--checker-b) 75%) 11px -11px / 22px 22px,
        linear-gradient(-45deg, transparent 75%, var(--checker-b) 75%) -11px 0 / 22px 22px,
        #111820;
    }
    .tile-card img {
      position: absolute;
      width: 88px;
      height: 88px;
      left: calc(50% - 44px);
      top: calc(50% - 44px);
      image-rendering: auto;
      pointer-events: none;
    }
    .tile-card code {
      color: var(--accent);
      font-size: 12px;
      text-align: center;
    }
    .stage-wrap {
      margin-top: 18px;
      overflow: auto;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      background:
        linear-gradient(45deg, var(--checker-a) 25%, transparent 25%) 0 0 / 32px 32px,
        linear-gradient(-45deg, var(--checker-a) 25%, transparent 25%) 0 16px / 32px 32px,
        linear-gradient(45deg, transparent 75%, var(--checker-b) 75%) 16px -16px / 32px 32px,
        linear-gradient(-45deg, transparent 75%, var(--checker-b) 75%) -16px 0 / 32px 32px,
        #111820;
      padding: 16px;
    }
    .stage {
      position: relative;
      width: ${previewColumns * tileSize}px;
      height: ${previewRows * tileSize}px;
      margin: 0 auto;
    }
    .stage img {
      position: absolute;
      width: ${spriteSize}px;
      height: ${spriteSize}px;
      image-rendering: auto;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <main class="stack">
    <section class="panel">
      <h1>Terrain Rock Preview</h1>
      <p>Generated terrain cluster set with full-sheet browsing and a stage preview that matches the in-game 32px cell plus ${spriteSize}px terrain sprite overlap.</p>
      <div class="meta">
        <span>${variants.length} variants</span>
        <span>Tile size: ${tileSize}px</span>
        <span>Sprite size: ${spriteSize}px</span>
        <span>Inset: ${spriteInset}px</span>
      </div>
    </section>

    <section class="panel">
      <h2>Variant Sheet</h2>
      <p>All generated terrain rocks on a transparent checker background.</p>
      <div class="sheet">
        ${variants.map((variant) => `
          <div class="tile-card">
            <div class="checker"><img src="./${variant}" alt="${variant}" /></div>
            <code>${variant}</code>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="panel">
      <h2>Tiling Sample</h2>
      <p>A deterministic overlapped field preview using the same 32px cell and ${spriteSize}px sprite sizing as the client renderer.</p>
      <div class="stage-wrap">
        <div class="stage" id="stage"></div>
      </div>
    </section>
  </main>

  <script>
    const variants = ${JSON.stringify(variants)};
    const tileSize = ${tileSize};
    const spriteSize = ${spriteSize};
    const spriteInset = ${spriteInset};
    const columns = ${previewColumns};
    const rows = ${previewRows};
    const stage = document.getElementById("stage");

    function hashCell(x, y) {
      let hash = 2166136261;
      const text = String(x) + ":" + String(y);
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      return hash >>> 0;
    }

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const variant = variants[hashCell(x, y) % variants.length];
        const img = document.createElement("img");
        img.src = "./" + variant;
        img.alt = variant;
        img.style.left = String(x * tileSize - spriteInset) + "px";
        img.style.top = String(y * tileSize - spriteInset) + "px";
        stage.appendChild(img);
      }
    }
  </script>
</body>
</html>
`;

writeFileSync(previewPath, html, "utf8");

