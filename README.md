# Metaobject Import/Export CLI (TUI)

An Ink-based TUI for exporting and importing Shopify Metaobjects with intelligent cross-environment reference handling.

## Key Features
- Multi-type Metaobject export with per-type live progress and back reference counting
- Import wizard with:
  - Table preview, per-row status (✔ success, ✖ failure), dual right-side panels (preview + current status)
  - Single-entry import (Enter) and Full import (Cmd/Ctrl+G)
  - Skip-on-error toggle (Cmd/Ctrl+S) to continue past failing entries
  - Import results persisted to `outputs/` as JSON summaries
- Cross-environment handle resolution (Metaobject/Product/Page/Collection/ProductVariant) with caching
- Normalisation
  - Metaobject types: `app--12345--Type` → `$app:Type`
  - Backref namespaces: `app--12345--ns` → `$app:ns`
- Back references
  - Export supports back references for Product, ProductVariant, Collection, Page (never Metaobject)
  - Full pagination performed per metaobject page; optimised with initial `referencedBy(first: 10)`

## Prerequisites
- Node 18+
- A Shopify Admin API access token configured in `.env.*`

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create environment files in the project root (see `example.env`):
   - e.g. `.env.development`

## Run
```bash
npm run dev
```

Starts in `Home`. The Connection panel shows the selected environment (or an empty state). Navigate to Environments to select or create a new environment.

## UI Hotkeys
- Global
  - Esc: focus navbar
- Home
  - Enter on outputs row: open Import wizard
- Import (Step 2)
  - Enter: import selected entry
  - Cmd/Ctrl+G: import all entries
  - v: toggle table/JSON preview
  - Cmd/Ctrl+S: toggle skip-on-error (ON/OFF)
  - Cmd/Ctrl+X: back to file selection
  - Arrow keys/PageUp/PageDown: navigate list while full import is running
- Export
  - Live per-type progress; backrefs total appears when enabled

## Environments
- Managed by `EnvironmentContext`
- `EnvSelector` shows `.env*` files
- `EnvSetup` can create new `.env.<name>` files; list auto-refreshes without restart

## Export Flow (high level)
1. For each requested type, fetch metaobjects in pages:
   - Query includes `fields` and `referencedBy(first: 10)`
   - Per page:
     - Build entries; extract initial backrefs from the page payload
     - If `referencedBy.pageInfo.hasNextPage`, paginate remaining backrefs in parallel and await before fetching next metaobject page
2. Normalise types (`app--…--Type` → `$app:Type`) and backref namespaces (`app--…--ns` → `$app:ns`)
3. Write a single JSON file in `outputs/`

## Import Flow (high level)
1. Single-entry (Enter) or full import (Cmd/Ctrl+G)
2. Transform fields:
   - Resolve any `handle://shopify/...` strings to GIDs using `HandleResolver`
   - Parse and resolve JSON-encoded arrays/objects (nested handles)
   - Drop unresolved handles (undefined) and empty arrays/objects
3. Upsert metaobject via GraphQL (`metaobjectUpsert`)
4. Post-pass back references (if present):
   - Normalise namespaces to `$app:`
   - Resolve owners and set metafields via `metafieldsSet` (single vs list is inferred)
5. Results tracked per entry (success/skipped/failed). Full-run summary saved to `outputs/` at completion.

## Cross-Environment Handle Resolution (with caching)

```text
+------------------------+       +--------------------------+
|  Exported JSON (src)   |       |   Import (dest store)    |
|                        |       |                          |
| fields: {              |       |  transformFieldsForImport|
|   variants: [          |       |    - For each field:     |
|     "handle://shopify/ | ----> |      resolve handle refs |
|      ProductVariant/   |       |      via HandleResolver  |
|      <product>/<sku>"  |       |                          |
|   ] }                  |       |  HandleResolver          |
+------------------------+       |   - In-memory Map cache  |
                                 |   - Routes by kind:      |
                                 |     Metaobject → metaobj |
                                 |     Product → productBy..|
                                 |     Page → pages(query)  |
                                 |     Variant → productBy..|
                                 |     Collection → collect.|
                                 |   - Returns GID or null  |
                                 +--------------------------+
                                           |
                                           | GIDs or skip unresolved
                                           v
                                 +--------------------------+
                                 |  metaobjectUpsert        |
                                 |  fields serialised JSON  |
                                 +--------------------------+

Post-pass back references:
- normalise `$app:` namespaces
- group by owner/namespace/key, infer single vs list
- `metafieldsSet` in chunks
```

### Notes
- Normalisation:
  - Metaobject types and backref namespaces are coerced to `$app:` variants both on export and import
  - Example: `app--258161311745--ComponentGroup` → `$app:ComponentGroup`
- Skipping unresolved handles prevents invalid reference errors (e.g. list of ProductVariants when some SKU missing)
- Back references never include Metaobject→Metaobject to avoid short circuits

## Code Map
- `src/utils/shopify/metaobjects.ts`
  - GraphQL queries for metaobjects and referencedBy
  - `toHandleRef` normalises Metaobject type to `$app:`
  - `fetchBackReferences`/`fetchBackReferencesFrom` for pagination
- `src/utils/shopify/resolve.ts`
  - HandleResolver with per-kind queries and in-memory caching
  - Normalises Metaobject type in handle refs before resolving
- `src/utils/importer.ts`
  - Upsert and backref application; field transformation and handle resolution
  - Skip-on-error support
- `src/utils/exporter.ts`
  - Export orchestration; per-type progress; per-page backref pagination
- `src/context/*`
  - Environments, import state/results, focus, navigation
- `src/ui/*`
  - Ink-based screens for Home, Import, Export, Environments

## Development
- TypeScript + ESM via `tsx`
- Linting (ESLint) with React hooks plugin

## License
MIT
