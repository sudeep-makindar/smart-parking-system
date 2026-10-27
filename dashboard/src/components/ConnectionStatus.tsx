interface Props {
  camera: boolean;
  controller: boolean;
}

/** One dot per primary node: camera and controller. */
export default function ConnectionStatus({ camera, controller }: Props) {
  const item = (label: string, ok: boolean) => (
    <span className="flex items-center gap-1.5" title={`${label} node ${ok ? "online" : "offline"}`}>
      <span className={`dot ${ok ? "animate-blink bg-accent-green" : "bg-danger"}`} />
      {label}
    </span>
  );
  return (
    <span className="flex items-center gap-3 text-[12px] font-medium text-txt-secondary" role="status">
      {item("Camera", camera)}
      {item("Gate", controller)}
    </span>
  );
}
