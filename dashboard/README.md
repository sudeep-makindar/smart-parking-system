# Smart Parking Dashboard

A Vite + React 18 + TypeScript + Tailwind CSS 3 app. It talks to the camera and controller
nodes over HTTP; you enter their addresses in **Settings → Nodes** (saved in the browser).

```bash
npm install
npm run dev:mock    # simulated nodes, no hardware
npm run dev         # real hardware, dev server reachable from other devices on the Wi-Fi
npm start           # production build served on http://<this-computer>:4173
```

- `src/hooks/useNodes.tsx`: the node registry. The first camera and first controller are the
  "primary" nodes used by the pages.
- `src/hooks/useParking.ts`: polls both primary nodes every second. It takes the slot array
  directly from the camera node and adds durations, gate and tickets from the controller.
- `src/api/parking.ts`: all node requests. `src/api/mock.ts` is the simulator; enable it with
  `VITE_MOCK=1` or `?mock` in the URL.
- Routing uses `HashRouter`, so the build works from any static host (laptop, Vercel, Netlify).
