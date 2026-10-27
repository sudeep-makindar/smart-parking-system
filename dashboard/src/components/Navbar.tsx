import { Link, NavLink } from "react-router-dom";
import ConnectionStatus from "./ConnectionStatus";
import LiveClock from "./LiveClock";

const tabs = [
  { to: "/", label: "Overview" },
  { to: "/live", label: "Live Feed" },
  { to: "/analytics", label: "Analytics" },
  { to: "/settings", label: "Settings" },
];

interface Props {
  isConnected: boolean;
  error: string | null;
  demo: boolean;
}

function Logo() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
      <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 14.5v-9h3.25a2.75 2.75 0 0 1 0 5.5H7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function Navbar({ isConnected, error, demo }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg-primary/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <div className="flex items-center gap-2.5 text-[14px]">
          <Logo />
          <span className="font-semibold tracking-tight">Smart Parking</span>
          <span className="hidden text-txt-muted sm:inline">/</span>
          <span className="hidden text-txt-secondary sm:inline">Zone A</span>
          {demo && <span className="pill-neutral ml-1 hidden sm:inline-flex">Demo</span>}
        </div>

        <nav className="hidden h-full items-stretch gap-6 md:flex" aria-label="Main">
          <Tabs />
        </nav>

        <div className="ml-auto flex items-center gap-5">
          <Link
            to="/sign"
            target="_blank"
            className="hidden h-8 items-center rounded-lg border border-border px-3 text-[12px] font-medium text-txt-secondary transition-colors hover:text-txt-primary lg:flex"
          >
            Entrance sign ↗
          </Link>
          <ConnectionStatus isConnected={isConnected} error={error} />
          <span className="hidden sm:block">
            <LiveClock />
          </span>
        </div>
      </div>

      <nav className="flex h-11 items-stretch gap-6 overflow-x-auto border-t border-border px-4 md:hidden" aria-label="Main">
        <Tabs />
      </nav>
    </header>
  );
}

function Tabs() {
  return (
    <>
      {tabs.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            `-mb-px flex items-center whitespace-nowrap border-b-2 text-[13px] font-medium transition-colors ${
              isActive
                ? "border-txt-primary text-txt-primary"
                : "border-transparent text-txt-secondary hover:text-txt-primary"
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </>
  );
}
