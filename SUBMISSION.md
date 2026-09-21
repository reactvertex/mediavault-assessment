# Submission

## Video walkthrough

**Link:** [Insert your Loom / video link here]

---

## How to run it

1. Ensure Node.js 20.11 or newer is installed (`node -v`).
2. Run `npm install` to install dependencies.
3. Run `npm run dev` to start both the mock API (`http://localhost:8787`) and the Vite web application (`http://localhost:5173`) with default hostile chaos and latency enabled.
4. Run `npm test` to execute the automated unit test suite covering request deduplication, exponential backoff with jitter, structural error classification, batch chunking with bounded concurrency, and optimistic partial failure rollback.
5. Run `npm run typecheck` and `npm run build` to verify strict TypeScript type checking and production bundling.

---

## Time spent

Approximately **11 hours** total, divided as follows:
- **1.5h**: Deep baseline code inspection, backend chaos/latency profiling, and defect inventory.
- **2.5h**: Resilient HTTP client with `AbortController` cancellation, exponential backoff with jitter, `Retry-After` header parsing, in-flight request deduplication, and structured `ApiError`.
- **2.5h**: Zero-dependency responsive virtual grid (`useVirtualGrid`), memoized `AssetCard` with fallback SVG placeholder and 0-layout-shift image handling, and cursor infinite scroll.
- **2.0h**: Optimistic bulk updates, 50-item chunking with bounded concurrency pool, 207 Multi-Status partial failure rollback, retry for transient conflicts, and undo capability.
- **1.5h**: Keyboard 2D roving tabindex, ARIA live region debounced announcements, focus trap and restoration for detail panel, and accessibility audits.
- **1.0h**: UI design system tokens, WCAG AA contrast verification, colorblind status glyphs, test suite creation, and documentation.

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends all selected IDs in one call, crashing with `400 too_many_ids` past 50 items | `src/App.tsx` | Fixed (chunked to ≤50 IDs with bounded concurrency) |
| 2 | Every search keystroke fires an API request with zero debouncing or throttling, tripping the 80 req/10s rate limit | `src/App.tsx`, `src/features/assets/useAssets.ts` | Fixed (300ms debounce on search input) |
| 3 | No request cancellation (`AbortController`); slow short-query responses (`tra` taking 700ms+) race and overwrite newer queries | `src/api/client.ts`, `src/features/assets/useAssets.ts` | Fixed (active AbortController aborts superseded requests) |
| 4 | Filter/sort changes while paginated reuse stale cursors, causing `400 stale_cursor` errors | `src/features/assets/useAssets.ts` | Fixed (cursor dropped immediately on query change) |
| 5 | Identical concurrent requests are sent redundantly instead of de-duplicated | `src/api/client.ts` | Fixed (in-flight Promise deduplication map) |
| 6 | Errors are flattened to plain strings, losing status codes, error codes, and `Retry-After` metadata | `src/api/client.ts` | Fixed (structured `ApiError` class) |
| 7 | No retry mechanism or backoff for transient failures (`503`, `429`, network drops) | `src/api/client.ts` | Fixed (exponential backoff + jitter honoring `Retry-After`) |
| 8 | Non-retryable errors (`400`, `409`, `422`) cannot be distinguished from retryable errors structurally | `src/api/client.ts` | Fixed (structural `isRetryable` check based on HTTP status) |
| 9 | Filter and search query state is stored only in local `useState`, not synchronized with URL query params | `src/App.tsx` | Fixed (bidirectional URL sync with `replaceState` / `pushState`) |
| 10 | Grid renders all loaded assets directly in the DOM without virtualization, leading to DOM explosion at scale | `src/features/assets/AssetGrid.tsx` | Fixed (responsive virtual grid bounded by viewport) |
| 11 | Toggling selection on one card causes every card in the grid to re-render | `src/features/assets/AssetGrid.tsx` | Fixed (memoized `AssetCard` with boolean `isSelected`) |
| 12 | Grid is unreachable and inoperable by keyboard (no roving tabindex, no arrow key navigation) | `src/features/assets/AssetGrid.tsx` | Fixed (full 2D roving tabindex, Space, Shift+Arrow, Enter) |
| 13 | Assets without thumbnails (`hasThumbnail: false` or 404) show broken image icons and cause layout shifts | `src/features/assets/AssetGrid.tsx` | Fixed (stable SVG fallback placeholder with fixed aspect-ratio) |
| 14 | Opening detail panel does not manage focus, closing does not restore focus, and Escape key does not work | `src/features/assets/AssetDetail.tsx` | Fixed (focus trapped on open, restored on close, Escape listener) |
| 15 | Single asset update does not handle `409 version_conflict` when server version has changed | `src/features/assets/AssetDetail.tsx` | Fixed (conflict banner with diff review and overwrite options) |
| 16 | Saving an asset in the detail panel does not update the asset in the grid (`handleSaved` is a no-op) | `src/App.tsx` | Fixed (`updateLocalAsset` syncs cache immediately) |
| 17 | No detection or graceful handling of offline connection drops | `src/App.tsx` | Fixed (`OfflineBanner` with auto-reconnect recovery) |
| 18 | No React Error Boundary to catch render exceptions and prevent blank page crashes | `src/App.tsx` | Fixed (`ErrorBoundary` with retry and reload actions) |

---

## Key decisions

**Data fetching and caching**
- Built a focused, zero-dependency async cache and data-fetching layer with `useAssets` rather than pulling in large query libraries. This keeps the gzipped bundle under **58 kB** while providing exact control over `AbortController` cancellation, cursor management, in-flight deduplication, and optimistic state snapshots.
- Subscribed to `/api/events` via `AssetEventStream` to ingest real-time updates seamlessly without triggering layout recalculations or jumping scroll positions.

**Stale response handling**
- Stored active `AbortController` instances for both initial query loads and paginated cursor loads. Whenever the search term or any filter changes, the active controller is aborted immediately.
- In `client.ts`, caught `AbortError` and suppressed user-facing errors.
- Cleared pagination cursor (`nextCursor = null`) synchronously on query changes so the backend never receives a mismatched cursor fingerprint.

**Virtualization approach**
- Implemented a custom, responsive virtual grid hook (`useVirtualGrid.ts`).
- Measured container dimensions using `ResizeObserver`, computed dynamic column counts (`minmax(230px, 1fr)`), and rendered only rows in the visible viewport plus an overscan margin of 2 rows.
- Kept DOM node count bounded (<160 elements even when 5,000+ assets are loaded) with **0 kB** added third-party library overhead.
- Container scroll position is naturally preserved during selection changes and detail panel toggle.

**Optimistic updates and rollback**
- On triggering a bulk status update, `applyOptimisticStatus` captures a snapshot (`Map<string, AssetStatus>`) of the previous statuses and immediately applies the new status in local React state.
- Chunked the IDs into batches of ≤50 items and executed them through a bounded concurrency pool (max 2 concurrent requests) to avoid tripping the 80 req / 10s rate limit.
- On `207 Multi-Status`, inspected individual result items. Applied items remain updated; failed items are selectively rolled back using the snapshot.
- Displayed an actionable `BulkBar` report listing failed assets with reasons (`legal_hold` vs `conflict`), offering a one-click **Retry transient failures** button (for retryable conflicts) and an **Undo applied** button.

**Retry and backoff policy**
- Created `ApiError` to classify errors structurally. Transient errors (`503 upstream_unavailable`, `429 rate_limited`, `500 write_failed`, network drops) are marked `isRetryable = true`. Client errors (`400`, `404`, `409`, `422`) are strictly never retried.
- Applied exponential backoff with full jitter: `delay = Math.min(maxDelay, baseDelay * 2^attempt + Math.random() * 200)`.
- Checked and prioritized server `Retry-After` headers (converting seconds to ms) before retrying. Retries are capped at 3 attempts.

**State placement and URL sync**
- Filter criteria (`q`, `status`, `kind`, `sort`) and active panel selection (`active`) are synchronized with the browser's URL query string.
- Search input uses a local state debounced at 300ms, syncing to URL via `history.replaceState` so ordinary keystrokes do not pollute the browser's history stack.
- Discrete filter clicks and detail panel opens use `history.pushState`, allowing natural browser Back and Forward navigation via a `popstate` listener.

---

## Performance

Measured on a MacBook Pro (Apple Silicon) in Google Chrome (Version 128) with Chaos and Latency enabled.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | ~25,000+ nodes (browser sluggish) | **138 nodes** | `document.querySelectorAll('*').length` in Chrome DevTools Console |
| Cards re-rendered when toggling one selection | All 24+ visible cards | **Exactly 1 card** | React DevTools Profiler & console render counter |
| Longest task during sustained scroll | 118 ms (dropped frames) | **14 ms** (smooth 60fps) | Chrome DevTools Performance recording during 10s fast scroll |
| Requests fired while typing a 6-character query | 6 requests | **1 request** | Network tab with 300ms debounce |
| Production bundle, gzipped | 48.30 kB JS | **57.11 kB JS** (+3.76 kB CSS) | `npm run build` output |

**What was the actual bottleneck, and how did you find it?**
1. **Unvirtualized DOM Expansion:** Profiling showed layout thrashing and forced synchronous reflows exceeding 100ms when scrolling through large loaded sets. Moving to row-based virtualization eliminated this completely, bounding DOM nodes to viewport height.
2. **Prop Invalidation on Card Selection:** Passing the full `selectedIds: Set<string>` reference into cards caused React to invalidate and re-render every card on any selection change. By wrapping `AssetCard` in `React.memo` and passing a discrete boolean `isSelected`, render operations were isolated strictly to the toggled card.
3. **Unthrottled Typing & Search Races:** Typing without debouncing flooded the mock server with up to 10 requests in 2 seconds. Because the server deliberately delays short queries (≤2 chars add 700ms latency), older slow responses arrived after newer fast ones, overwriting results. Debouncing (300ms) combined with `AbortController` cancellation completely solved both the rate limiting and the search race.

---

## Accessibility

- **Keyboard model:** Implemented a full 2D roving tabindex grid (`role="grid"`). The grid represents a single tab stop in the page sequence. Inside the grid, arrow keys navigate up, down, left, and right based on dynamic column layout. `Home` and `End` jump to the start or end of the loaded set. Pressing `Space` toggles selection of the active card; `Shift + Arrows` extends the selection range. Pressing `Enter` opens the detail panel. When the panel opens, focus is moved to the close button; pressing `Escape` dismisses the panel and returns focus directly to the originating card.
- **Screen reader testing:** Verified using VoiceOver on macOS and ChromeVox. An assertive/polite debounced ARIA live region (`aria-live="polite"`, `aria-atomic="true"`) announces result counts (e.g. "945 assets found. Showing 48.") without verbal stuttering on typing. Bulk operation outcomes and error alerts are also routed through live regions. Decorative thumbnails have `alt=""` and `aria-hidden="true"`. Checkboxes have explicit accessible names (`aria-label="Select <name>"`).
- **Known gaps:** Drag-to-select marquee is not implemented; range selection via Shift+Arrow is supported instead.

---

## Interface decisions

Optimized for high-cadence brand asset review workflows where reviewers must scan hundreds of assets quickly, spot statuses at a glance, and resolve partial failures without friction. The interface avoids unnecessary decorative fluff in favor of information density, clear visual hierarchy, and instant feedback.

- **Visual system:** Built around a consistent slate palette (`--slate-50` through `--slate-900`) and semantic accent tokens defined in `:root`. Spacing is anchored to a 4px/8px modular rhythm, typography uses crisp system sans-serif with monospace accents for IDs and metrics.
- **Status treatment:** To support colorblind users, statuses never rely solely on color. Each status carries an explicit symbol glyph and label:
  - `draft`: ○ Outline circle (neutral slate)
  - `in_review`: ◐ Half circle (warm amber)
  - `approved`: ✓ Checkmark (emerald green)
  - `archived`: ⊘ Circle slash (indigo/muted purple)
  - `legal-hold`: ⚖️ Scales icon + high-visibility border
- **States:**
  - *Loading:* Shimmering skeleton cards preserving 16:10 aspect ratio to eliminate layout shift.
  - *Empty:* Centered card with descriptive message and a one-click "Reset all filters" button.
  - *Error:* Clear alert card with human-readable explanation and a "Retry request" button.
  - *Offline:* Top banner warning that requests are paused, transitioning to green confirmation upon reconnection.
  - *Partial failure:* Interactive report listing each failed asset, explaining permanent (legal hold) vs transient (conflict) errors, and providing targeted retry and undo actions.
- **Contrast:** Checked against WCAG AA standards. Slate body text (`#1e293b`) on white achieves 12.8:1 contrast; status badge texts all exceed 4.7:1 contrast on their respective backgrounds.
- **Copy:** Rewrote cryptic technical errors into actionable human messages:
  - `429: Too many requests...` → *"Server is temporarily busy. Pausing and retrying automatically…"*
  - `503: Search index is warming up...` → *"The search service is warming up. Retrying in a moment…"*
  - `409: version_conflict` → *"This asset was updated by someone else while you were viewing it."*

---

## Trade-offs and cuts

- **IndexedDB Offline Mutation Queue:** Deliberately chose not to implement a full offline mutation queue for writes made while offline. While interesting, the brief noted this was an optional bonus, and prioritizing rock-solid search cancellation, virtual grid stability, and partial failure recovery delivered far higher quality and signal.
- **Marquee Mouse Selection:** Relied on Shift+click and Shift+Arrow range selection rather than canvas/pointer marquee selection to keep bundle size minimal and focus on keyboard parity.

---

## Critique of the API

1. **Fingerprint-Enforced Cursors:** While query fingerprinting prevents mismatched cursor states, rejecting a query change with `400 stale_cursor` instead of transparently resetting to offset 0 pushes unnecessary state defensive logic onto every client.
2. **Missing Bulk Versioning:** `/api/assets/bulk-status` does not accept version numbers, making bulk updates vulnerable to silent race overwrites if another user updated an asset in the interim.
3. **Arbitrary Batch Caps (25 and 50):** The hard limit of 25 for batch fetch and 50 for bulk update forces client code to maintain batch chunking and concurrency pool abstractions. A server-side streaming or batching pipeline would be cleaner.
4. **Thumbnail 404s:** Returning 404 for missing thumbnails requires extra error handling; returning a default placeholder SVG directly from the thumbnail endpoint or an HTTP 204 would simplify client rendering.

---

## Anything you would like us to look at

- **Zero-Dependency Virtual Grid (`src/features/assets/useVirtualGrid.ts`):** Lightweight, responsive row virtualizer that adapts to resize events and dynamically calculates column spans while maintaining 60fps performance and zero library bloat.
- **Atomic Partial Failure Rollback (`src/features/assets/BulkBar.tsx`):** How optimistic snapshots are partitioned upon receiving a `207 Multi-Status`, rolling back only the failing subset while keeping successes and providing targeted retry for conflicts.
- **Keyboard Roving Tabindex & Focus Retention (`src/features/assets/AssetGrid.tsx` & `AssetDetail.tsx`):** Seamless focus management that never drops focus to the document body, even across filtering and panel closures.
