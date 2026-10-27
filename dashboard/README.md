# Smart Parking Dashboard

Vite + React 18 + TypeScript + Tailwind CSS 3. It is served by the ESP32-S3 from SPIFFS.

```bash
npm install
npm run dev:mock    # simulated data, no hardware
npm run dev         # real hardware (see .env.example)
npm run build       # -> dist/ (~75 KB gzipped)
```

- `src/api/parking.ts` is the fetch layer. In production it uses same-origin URLs. In dev it
  uses `VITE_API_URL` (default `http://192.168.4.1`).
- `src/api/mock.ts` is the in-browser simulator. Enable it with `VITE_MOCK=1` or `?mock` in the URL.
- `src/hooks/useParking.ts` polls `/api/status` every 1.5 s. It keeps the last good data while
  offline and tracks latency and success rate.
- Routing uses `HashRouter` (`/#/analytics`), so the ESP32 needs no SPA fallback route.
- Build output is flat with short hashed names (`a-XXXXXXXX.js`), because SPIFFS file names are
  limited to 31 characters and SPIFFS has no folders.

To deploy, run `../scripts/upload_dashboard.sh <serial-port>` from the repo root.
