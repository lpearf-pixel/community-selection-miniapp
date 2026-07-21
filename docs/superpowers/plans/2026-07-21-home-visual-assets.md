# Home Visual Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the L49 home page's color-only placeholders with real, package-local 春华秋实 hero and catalog photography while preserving dynamic API data and remote product images.

**Architecture:** Keep the existing template-driven home shell. Add one compressed local hero asset and one five-panel catalog sprite; template data describes their paths and slice offsets. The home model keeps valid remote or existing local product images, but converts missing and legacy `/images/products/placeholder.png` values into deterministic sprite fallbacks.

**Tech Stack:** WeChat Mini Program WXML/WXSS/CommonJS, Node built-in test runner, TypeScript static gate, JPEG assets.

## Global Constraints

- Keep `GET /api/products` and `GET /api/group-buys` as the only home data sources.
- A valid `https://`, `http://`, `wxfile://`, `cloud://`, or package-local asset image remains authoritative.
- Missing images and the legacy `/images/products/placeholder.png` value use package-local fallback photography.
- Do not modify payment, refund, inventory, reward, or group-buy business rules.
- Keep the two new visual assets together below 500 KiB so the Mini Program main package does not absorb the original multi-megabyte PNGs.

---

### Task 1: Lock the visual and image-normalization contracts

**Files:**
- Modify: `apps/miniapp/pages/index/home-model.test.cjs`
- Modify: `scripts/verify-l49-brand-home-local.ts`

**Interfaces:**
- Consumes: `normalizeHomeProduct(raw, index)` and `normalizeHomeGroupBuy(raw, index)`.
- Produces: failing assertions for `fallbackImage`, `fallbackOffset`, hero image wiring, sprite rendering, and asset-size limits.

- [x] Add tests proving valid remote images remain unchanged and missing/legacy placeholder values select deterministic local sprite fallbacks.
- [x] Add static checks requiring `heroImagePath`, `catalogSpritePath`, photographic `<image>` nodes, and both compressed assets.
- [x] Run `node --test apps/miniapp/pages/index/home-model.test.cjs` and the L49 static gate; confirm failures point only to missing visual behavior.

### Task 2: Add compressed package-local photography

**Files:**
- Create: `apps/miniapp/assets/brand/chunhuaqiushi-hero.jpg`
- Create: `apps/miniapp/assets/catalog/chunhuaqiushi-catalog-sprite.jpg`

**Interfaces:**
- Produces: `/assets/brand/chunhuaqiushi-hero.jpg` and `/assets/catalog/chunhuaqiushi-catalog-sprite.jpg`.

- [x] Convert the approved generated hero to a stripped, resized JPEG.
- [x] Convert the approved five-panel catalog sprite to a stripped, resized JPEG.
- [x] Verify both files are valid JPEGs and their combined byte size is below 512000.

### Task 3: Render the hero and catalog fallback photography

**Files:**
- Modify: `apps/miniapp/pages/index/templates/chunhuaqiushi.js`
- Modify: `apps/miniapp/pages/index/home-model.js`
- Modify: `apps/miniapp/components/home/brand-hero/index.wxml`
- Modify: `apps/miniapp/components/home/brand-hero/index.wxss`
- Modify: `apps/miniapp/components/home/category-grid/index.wxml`
- Modify: `apps/miniapp/components/home/category-grid/index.wxss`
- Modify: `apps/miniapp/components/home/product-showcase/index.wxml`
- Modify: `apps/miniapp/components/home/product-showcase/index.wxss`
- Modify: `apps/miniapp/components/home/group-buy-showcase/index.wxml`
- Modify: `apps/miniapp/components/home/group-buy-showcase/index.wxss`
- Modify: `apps/miniapp/styles/themes/chunhuaqiushi.wxss`

**Interfaces:**
- `selectHomeImage(source, index)` returns `{ coverImage, fallbackImage, fallbackOffset }`.
- A sprite crop container uses a 500%-wide image and `left: -N00%` to expose one of five panels.

- [x] Add hero and sprite paths plus fixed category offsets to the template.
- [x] Add minimal image selection and fallback logic to the home model.
- [x] Render the hero image behind a readable gradient copy layer.
- [x] Replace category emoji-only tiles and product/group placeholder blocks with sprite-backed image crops.
- [x] Run home-model tests, L49 static verification, E2E helper tests, and JS syntax checks; all must pass.

### Task 4: Publish without widening scope

**Files:**
- Modify only the files listed above on `codex/l49-brand-home-e2e`.

- [ ] Re-read the branch HEAD and confirm it is still `0b5a7adb224f4251f973dc3ec0377abe30ae0b05`.
- [ ] Create blobs/tree/commit for the tested files and fast-forward the existing branch; do not create or merge a PR.
- [ ] Re-fetch changed files from the new HEAD, compare their Git blob hashes with the tested local files, and report the Mac recompile command.
