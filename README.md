# Metaobject Import Export (CLI TUI)

Minimal Ink-based CLI scaffolding. Select a .env file and proceed to a placeholder Home screen.

## Prerequisites
- Node 18+

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create environment files in project root (example already provided):
   - `.env.development`

## Run
```bash
npm run dev
```

Use arrow keys to select an environment, press Enter to continue. Ctrl+C to exit.

## Stack
- Ink (React) for TUI
- ink-select-input for selection
- dotenv for environment loading
- TypeScript via tsx (ESM)

## Aliases
TypeScript path aliases are configured in `tsconfig.json`:
- `@/` → `src/`
- `@context/*` → `src/context/*`
- `@ui/*` → `src/ui/*`
- `@utils/*` → `src/utils/*`

Example:
```ts
import { listEnvFiles } from '@utils/envFiles';
import { EnvironmentProvider } from '@context/EnvironmentContext';
```
