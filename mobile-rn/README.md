# FIELD FUSSION — Native Mobile App (`React Native 0.86.2` + `Re.Pack`)

> **Important Distinction:**
> - **`src/mobile-pwa/`** is the **Mobile Field PWA Prototype** runnable inside Google AI Studio's web container (`/mobile`).
> - **`mobile-rn/` (this folder)** is the **separate native Android/iOS React Native 0.86.2 application scaffold** configured for Re.Pack (`@callstack/repack`) and excluded from the Vite web bundle (`tsconfig.json` excludes `mobile-rn`).

## Shared Core Reuse (`../src/shared`)
This native app imports the exact same business logic, types, Zod validators, i18n dictionaries (`en`, `lg`, `sw`), and REST API client (`FieldFussionApiClient`) from `../src/shared/`.

## Phase 1 & Phase 2 Scope
- `package.json`: Pins `react-native` `0.86.2` and `@callstack/repack` compatibility.
- `rspack.config.mjs`: Configures Re.Pack module resolution to bundle `../src/shared`.
- `src/App.tsx`: Native shell wired to `FieldFussionApiClient` (`/api/v1/auth/me` and `/api/v1/farms`), `calculateGeoJsonArea`, and `searchUgandaGazetteer` from `../src/shared/`.
- **Native Mapping & Offline Storage Target**: Bind `src/shared/geo/` and `FieldFussionApiClient` farm endpoints to `@maplibre/maplibre-react-native` (OSM/satellite tiles) + `react-native-mmkv` / SQLite offline queue mirroring `src/mobile-pwa/offlineDb.ts` (`expectedVersion` + `409 FARM_VERSION_CONFLICT`).

## Running Outside AI Studio
AI Studio does not provide Android Gradle/SDK or iOS Xcode emulators. Build and run this target in a native mobile environment:
```bash
cd mobile-rn
npm install
npx react-native start --webpackConfig rspack.config.mjs
npx react-native run-android
```
