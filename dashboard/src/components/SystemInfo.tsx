import type { ReactNode } from "react";

export interface InfoItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

interface Props {
  title: string;
  items: InfoItem[];
  action?: ReactNode;
  children?: ReactNode;
}

/** Panel with a title and label/value rows. */
export default function SystemInfo({ title, items, action, children }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {action}
      </div>
      <dl className="divide-y divide-border px-5">
        {items.map(({ label, value, mono }) => (
          <div key={label} className="kv">
            <dt>{label}</dt>
            <dd className={`truncate ${mono ? "font-mono text-[12px]" : "num"}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}
