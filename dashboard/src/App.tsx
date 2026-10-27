import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import { API_BASE, USE_MOCK } from "./api/parking";
import { useParking, type ParkingState } from "./hooks/useParking";
import Analytics from "./pages/Analytics";
import LiveFeedPage from "./pages/LiveFeedPage";
import Overview from "./pages/Overview";
import Settings from "./pages/Settings";
import SignPage from "./pages/SignPage";
import TicketPage from "./pages/TicketPage";

function Connecting({ error }: { error: string | null }) {
  return (
    <div className="mx-auto mt-16 max-w-sm animate-fade-in">
      <div className="panel p-6">
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          <span className={`dot ${error ? "bg-danger" : "animate-blink bg-txt-secondary"}`} />
          {error ? "Can't reach the controller" : "Connecting…"}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-txt-secondary">
          Join the <span className="font-mono text-txt-primary">SmartParking</span> Wi-Fi (password{" "}
          <span className="font-mono text-txt-primary">park1234</span>) and keep this page open.
        </p>
        <p className="mt-4 border-t border-border pt-3 font-mono text-[11px] text-txt-muted">
          {API_BASE || window.location.origin}/api/status
        </p>
        {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
      </div>
    </div>
  );
}

/** Dashboard pages with the navbar. */
function Shell({ parking }: { parking: ParkingState }) {
  const { data, isConnected, error } = parking;
  return (
    <>
      <Navbar isConnected={isConnected} error={error} demo={USE_MOCK} />
      <main className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6">
        {!data ? (
          <Connecting error={error} />
        ) : (
          <Routes>
            <Route path="/" element={<Overview data={data} isConnected={isConnected} />} />
            <Route path="/live" element={<LiveFeedPage data={data} parking={parking} />} />
            <Route path="/analytics" element={<Analytics data={data} />} />
            <Route path="/settings" element={<Settings data={data} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </>
  );
}

export default function App() {
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
