import { useId } from "react";

interface Props {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

/** Settings row: label and description on the left, slider on the right. */
export default function ThresholdSlider({
  label,
  description,
  min,
  max,
  step,
  value,
  defaultValue,
  onChange,
  format = String,
}: Props) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  const isDefault = Math.abs(value - defaultValue) < step / 2;

  return (
    <div className="grid gap-3 py-5 sm:grid-cols-[1fr_minmax(0,1.1fr)] sm:gap-8">
      <div>
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <p className="mt-1 text-[12px] leading-relaxed text-txt-secondary">{description}</p>
      </div>
      <div>
        <div className="flex items-center gap-4">
          <input
            id={id}
            type="range"
            className="slider"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ ["--fill" as string]: `${fill}%` }}
          />
          <span className="num w-12 shrink-0 rounded-md border border-border px-2 py-1 text-center font-mono text-[12px]">
            {format(value)}
          </span>
        </div>
        <div className="mt-1 flex justify-between pr-16 text-[11px] text-txt-muted">
          <span className="num">{format(min)}</span>
          {isDefault ? (
            <span>Default</span>
          ) : (
            <button type="button" className="hover:text-txt-primary" onClick={() => onChange(defaultValue)}>
              Reset to {format(defaultValue)}
            </button>
          )}
          <span className="num">{format(max)}</span>
        </div>
      </div>
    </div>
  );
}
