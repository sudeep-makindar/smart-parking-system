import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { USE_MOCK } from "../api/parking";
import type { NodeConfig, NodeKind } from "../types/parking";

const STORAGE_KEY = "smart-parking-nodes";

// The camera node is always 192.168.4.1 on its own "ParkingCam" Wi-Fi; the controller gets an IP from it (shown on its OLED)
const DEFAULT_NODES: NodeConfig[] = [
  { id: "cam-1", name: "Camera A", kind: "camera", host: "192.168.4.1" },
  { id: "ctrl-1", name: "Gate controller", kind: "controller", host: "parking-gate.local" },
];
const MOCK_NODES: NodeConfig[] = [
  { id: "cam-1", name: "Camera A", kind: "camera", host: "192.168.43.20" },
  { id: "ctrl-1", name: "Gate controller", kind: "controller", host: "192.168.43.21" },
];

function load(): NodeConfig[] {
  if (USE_MOCK) return MOCK_NODES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as NodeConfig[]) : null;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return DEFAULT_NODES;
}

function save(nodes: NodeConfig[]) {
  if (USE_MOCK) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
  } catch {
    /* private mode: settings last for this session only */
  }
}

interface NodesContextValue {
  nodes: NodeConfig[];
  /** First node of each kind drives the Overview, Live Feed and Analytics pages */
  camera: NodeConfig | null;
  controller: NodeConfig | null;
  addNode: (kind: NodeKind) => void;
  updateNode: (id: string, patch: Partial<Omit<NodeConfig, "id">>) => void;
  removeNode: (id: string) => void;
  makePrimary: (id: string) => void;
}

const NodesContext = createContext<NodesContextValue | null>(null);

export function NodesProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<NodeConfig[]>(load);

  const commit = useCallback((next: NodeConfig[]) => {
    setNodes(next);
    save(next);
  }, []);

  const value = useMemo<NodesContextValue>(() => {
    const count = (kind: NodeKind) => nodes.filter((n) => n.kind === kind).length;
    return {
      nodes,
      camera: nodes.find((n) => n.kind === "camera") ?? null,
      controller: nodes.find((n) => n.kind === "controller") ?? null,
      addNode: (kind) =>
        commit([
          ...nodes,
          {
            id: `${kind}-${Date.now().toString(36)}`,
            name: kind === "camera" ? `Camera ${String.fromCharCode(65 + count("camera"))}` : `Controller ${count("controller") + 1}`,
            kind,
            host: "",
          },
        ]),
      updateNode: (id, patch) => commit(nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))),
      removeNode: (id) => commit(nodes.filter((n) => n.id !== id)),
      makePrimary: (id) => {
        const node = nodes.find((n) => n.id === id);
        if (node) commit([node, ...nodes.filter((n) => n.id !== id)]);
      },
    };
  }, [nodes, commit]);

  return <NodesContext.Provider value={value}>{children}</NodesContext.Provider>;
}

export function useNodes(): NodesContextValue {
  const ctx = useContext(NodesContext);
  if (!ctx) throw new Error("useNodes must be used inside <NodesProvider>");
  return ctx;
}
