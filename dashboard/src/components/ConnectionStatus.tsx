interface Props {
  isConnected: boolean;
  error?: string | null;
}

export default function ConnectionStatus({ isConnected, error }: Props) {
  return (
    <span
      className="flex items-center gap-2 text-[12px] font-medium text-txt-secondary"
      title={isConnected ? "Receiving data from the controller" : error ?? "No response from the controller"}
      role="status"
    >
      <span className={`dot ${isConnected ? "animate-blink bg-accent-green" : "bg-danger"}`} />
      {isConnected ? "Connected" : "Offline"}
    </span>
  );
}
