# Quickstart: Coarsen Moving Buildings

## Focused validation

1. Run the direct lifecycle unit coverage:

   ```bash
   node --test tests/poi-background-lifecycle.test.mjs
   ```

2. Run the map synchronization browser test:

   ```bash
   npx playwright test -c playwright.config.mjs tests/map-render-sync.spec.mjs --project chromium-desktop
   ```

3. Build production:

   ```bash
   npm run build
   ```

4. Start the local application and verify:

   - the 3D map, buildings, highlighted venues, event controls, and minimap load;
   - movement reports the temporary value 24;
   - the map returns to full-detail value 4 after movement.

5. Run the comparable performance gate:

   ```bash
   npm run benchmark:release
   ```

## Expected result

All checks pass, the benchmark remains within every configured budget, full visual quality restores after movement, and no unrelated source file changes are introduced.
