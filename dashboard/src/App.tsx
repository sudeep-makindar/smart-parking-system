import { HashRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import { USE_MOCK } from "./api/parking";
import { NodesProvider, useNodes } from "./hooks/useNodes";
import { useParking, type ParkingState } from "./hooks/useParking";
import Analytics from "./pages/Analytics";
import LiveFeedPage from "./pages/LiveFeedPage";
import Overview from "./pages/Overview";
import Settings from "./pages/Settings";
import SignPage from "./pages/SignPage";
import TicketPage from "./pages/TicketPage";

function Connecting({ parking }: { parking: ParkingState }) {
  const { camera, controller } = useNodes();
  const row = (label: string, host: string | undefined, ok: boolean, error: string | null) => (
    <div className="kv">
      <dt>{label}</dt>
      <dd className="font-mono text-[12px]">
        {host || "not set"} <span className={ok ? "text-accent-green" : "text-danger"}>{ok ? "● online" : error ? "● offline" : "…"}</span>
      </dd>
    </div>
  );
  return (
    <div className="mx-auto mt-16 max-w-md animate-fade-in">
      <div className="panel p-6">
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          <span className="dot animate-blink bg-txt-secondary" />
          Looking for your nodes…
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-txt-secondary">
          Connect this device to the same Wi-Fi as the ESP32 boards, then enter their IP addresses in Settings. Each
          board prints its IP on the Serial Monitor, and the controller shows it on the OLED.
        </p>
        <dl className="mt-3 divide-y divide-border border-t border-border">
          {row("Camera node", camera?.host, parking.camera.isConnected, parking.camera.error)}
          {row("Controller node", controller?.host, parking.controller.isConnected, parking.controller.error)}
        </dl>
        <Link to="/settings" className="btn-primary mt-5 w-full">
          Open Settings → Nodes
        </Link>
      </div>
    </div>
  );
}

/** Dashboard pages with the navbar. Settings is always reachable so nodes can be configured. */
function Shell({ parking }: { parking: ParkingState }) {
  const { data, isConnected } = parking;
  return (
    <>
      <Navbar camera={parking.camera.isConnected} controller={parking.controller.isConnected} demo={USE_MOCK} />
      <main className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6">
        <Routes>
          <Route path="/settings" element={<Settings parking={parking} />} />
          {!data ? (
            <Route path="*" element={<Connecting parking={parking} />} />
          ) : (
            <>
              <Route path="/" element={<Overview data={data} isConnected={isConnected} />} />
              <Route path="/live" element={<LiveFeedPage data={data} parking={parking} />} />
              <Route path="/analytics" element={<Analytics data={data} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </main>
    </>
  );
}

function Root() {
  const parking = useParking();
  return (
    <HashRouter>
      <Routes>
        {/* Standalone screens: entrance display and the phone ticket from the QR code */}
        <Route path="/sign" element={<SignPage parking={parking} />} />
        <Route path="/ticket/:id" element={<TicketPage />} />
        <Route path="/*" element={<Shell parking={parking} />} />
      </Routes>
    </HashRouter>
  );
}

export default function App() {
  return (
    <NodesProvider>
      <Root />
    </NodesProvider>
  );
}
