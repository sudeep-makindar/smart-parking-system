import { USE_MOCK } from "../api/parking";
import type { ParkingState } from "../hooks/useParking";
import { useNodes } from "../hooks/useNodes";
import { usePolling } from "../hooks/usePolling";
import { getCameraStatus, getStatus } from "../api/parking";
import type { CameraStatus, ControllerStatus, NodeConfig } from "../types/parking";
import { formatHms } from "../utils/format";

interface StatusInfo {
  online: boolean;
  checked: boolean;
  firmware?: string;
  ip?: string;
  rssi?: number;
  uptime?: number;
  latency?: number | null;
  error?: string | null;
}

/** Polls a non-primary node itself; primary nodes reuse the dashboard's polling. */
function useNodeHealth(node: NodeConfig, primary: ParkingState["camera"] | ParkingState["controller"] | null): StatusInfo {
  const host = primary ? "" : node.host.trim();
  const own = usePolling<CameraStatus | ControllerStatus>(
    host,
    () => (node.kind === "camera" ? getCameraStatus(host) : getStatus(host)),
    3000,
  );
  const p = primary ?? own;
  return {
    online: p.isConnected,
    checked: p.lastUpdated !== null || p.error !== null,
    firmware: p.data?.firmware,
    ip: p.data?.ip,
    rssi: p.data?.rssi,
    uptime: p.data?.uptime_s,
    latency: p.latencyMs,
    error: p.error,
  };
}

function NodeRow({ node, index, parking }: { node: NodeConfig; index: number; parking: ParkingState }) {
  const { nodes, updateNode, removeNode, makePrimary, camera, controller } = useNodes();
  const isPrimary = (node.kind === "camera" ? camera : controller)?.id === node.id;
  const primaryPoll = isPrimary ? (node.kind === "camera" ? parking.camera : parking.controller) : null;
  const health = useNodeHealth(node, primaryPoll);
  const sameKind = nodes.filter((n) => n.kind === node.kind).length;

  return (
    <div className="grid gap-3 border-t border-border px-5 py-4 first:border-t-0 md:grid-cols-[2rem_1fr_auto] md:items-start">
      <span className="font-mono text-[12px] text-txt-muted">#{index + 1}</span>

      <div className="grid gap-3 sm:grid-cols-[1fr_8.5rem_1.2fr]">
        <label className="block">
          <span className="label">Name</span>
          <input
            value={node.name}
            onChange={(e) => updateNode(node.id, { name: e.target.value })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-primary px-3 text-[13px] outline-none focus:border-txt-secondary"
          />
        </label>
        <label className="block">
          <span className="label">Type</span>
          <select
            value={node.kind}
            onChange={(e) => updateNode(node.id, { kind: e.target.value as NodeConfig["kind"] })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-primary px-2 text-[13px] outline-none focus:border-txt-secondary"
          >
            <option value="camera">Camera</option>
            <option value="controller">Controller</option>
          </select>
        </label>
        <label className="block">
          <span className="label">IP address or hostname</span>
          <input
            value={node.host}
            placeholder={node.kind === "camera" ? "e.g. 192.168.43.20" : "e.g. 192.168.43.21"}
            onChange={(e) => updateNode(node.id, { host: e.target.value })}
            spellCheck={false}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-primary px-3 font-mono text-[13px] outline-none focus:border-txt-secondary"
          />
        </label>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-txt-secondary sm:col-span-3">
          <span className={`flex items-center gap-1.5 font-medium ${health.online ? "text-accent-green" : node.host ? "text-danger" : "text-txt-muted"}`}>
            <span className={`dot ${health.online ? "animate-blink bg-accent-green" : node.host ? "bg-danger" : "bg-txt-muted"}`} />
            {health.online ? "Online" : !node.host ? "No address" : health.checked ? "Offline" : "Checking…"}
          </span>
          {health.online ? (
            <>
              <span className="num">{health.latency} ms</span>
              {health.rssi !== undefined && <span className="num">{health.rssi} dBm</span>}
              {health.uptime !== undefined && <span className="num font-mono">up {formatHms(health.uptime)}</span>}
              {health.firmware && <span className="font-mono">v{health.firmware}</span>}
            </>
          ) : (
            node.host && health.error && <span className="text-txt-muted">{health.error}</span>
          )}
          {isPrimary && sameKind > 1 && <span className="pill-neutral">Primary</span>}
        </div>
      </div>

      <div className="flex gap-2 md:pt-5">
        {!isPrimary && (
          <button type="button" className="btn-secondary h-8 px-3 text-[12px]" onClick={() => makePrimary(node.id)}>
            Make primary
          </button>
        )}
        <button
          type="button"
          className="btn-secondary h-8 px-3 text-[12px] hover:!text-danger"
          onClick={() => removeNode(node.id)}
          aria-label={`Remove ${node.name}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/** Settings > Nodes: every device the dashboard talks to, by IP. */
export default function NodeManager({ parking }: { parking: ParkingState }) {
  const { nodes, addNode } = useNodes();

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Nodes</h2>
          <p className="mt-0.5 text-[12px] text-txt-secondary">
            Devices on your Wi-Fi. Each node prints its IP on the Serial Monitor; the controller also shows it on the OLED.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-secondary h-8 px-3 text-[12px]" onClick={() => addNode("camera")} disabled={USE_MOCK}>
            + Camera
          </button>
          <button type="button" className="btn-secondary h-8 px-3 text-[12px]" onClick={() => addNode("controller")} disabled={USE_MOCK}>
            + Controller
          </button>
        </div>
      </div>
      {nodes.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-txt-secondary">No nodes yet. Add a camera and a controller.</p>
      ) : (
        nodes.map((n, i) => <NodeRow key={n.id} node={n} index={i} parking={parking} />)
      )}
      <p className="border-t border-border px-5 py-3 text-[11px] text-txt-muted">
        The first node of each type drives the Overview, Live Feed and Analytics pages. Addresses are saved in this browser.
        {USE_MOCK && " Demo mode uses simulated nodes."}
      </p>
    </section>
  );
}
