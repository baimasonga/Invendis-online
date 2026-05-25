---
name: field-app native module crashes
description: Which native modules caused Android instant-crash and what the correct minimal config is.
---

## Root cause pattern

Android kills a React Native app immediately at launch when ANY installed native module fails to initialize. This happens before JS loads — ErrorBoundary cannot catch it.

## Crash history (all resolved)

All of these were in package.json but unused in app code, and caused instant Android crashes:
- `react-native-keyboard-controller` — missing Expo plugin
- `react-native-reanimated` — not used anywhere
- `react-native-worklets` — not used anywhere
- `react-native-svg` — not used anywhere
- `expo-symbols` — iOS-only (SF Symbols), no Android native support
- `expo-linear-gradient` — not used anywhere
- `expo-image` — not used anywhere
- `expo-system-ui` — not used anywhere
- `expo-web-browser` — not used in code
- `expo-secure-store v56` — **version incompatible with Expo SDK 54**; its Android native code requires a newer expo-modules-core than SDK 54 provides → instant crash

## expo-secure-store rule

**Never use `expo-secure-store` with Expo SDK 54.** Version 56 (added by a previous session) is incompatible with expo-modules-core bundled in SDK 54.

**Why:** Expo SDK 54 bundles expo-modules-core at its own version. expo-secure-store v56 expects a newer ABI. Mismatch = native crash.

**How to apply:** AuthContext uses `AsyncStorage` (from `@react-native-async-storage/async-storage`) for token storage — do NOT switch back to SecureStore unless the Expo SDK version is also upgraded to match.

## Current clean native module list (as of last fix)

Packages that ARE installed and ARE safe:
- `expo-blur` — used in tabs layout (iOS only BlurView, Android uses View)
- `expo-constants` — stable
- `expo-font` — stable  
- `expo-haptics` — used in many screens
- `expo-image-picker` — used in confirm-pod
- `expo-location` — used in confirm-pod
- `expo-router` — core routing
- `expo-splash-screen` — stable
- `expo-status-bar` — stable
- `expo-camera` — used in scan screen (lazy-loaded)
- `react-native-gesture-handler` — used in _layout GestureHandlerRootView
- `react-native-safe-area-context` — stable
- `react-native-screens` — stable

## Config settings

- `newArchEnabled: false` in app.json — disabled because several packages may not support New Architecture
- `expo-web-browser` removed from plugins (not used in code)
