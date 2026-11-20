import React, { useRef } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export interface ClockTimePickerProps {
  value: string; // "HH:mm" (24h) or "h:mm A"
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
}

// Convert "h:mm A" or "HH:mm" to standard 24h "HH:mm" for <input type="time">
export function to24HourTime(str: string): string {
  if (!str) return "";
  const cleaned = str.trim();

  // If already "HH:mm" (e.g. "09:30" or "21:45")
  if (/^\d{1,2}:\d{2}$/.test(cleaned)) {
    const [h, m] = cleaned.split(":");
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  }

  // If 12-hour format e.g. "9:30 AM" or "10:00 PM"
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/i);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2] ? match[2].padStart(2, "0") : "00";
    const period = match[3]?.toUpperCase();

    if (period === "PM" && hour < 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;

    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  return "";
}

// Convert 24h "HH:mm" to display 12h string "hh:mm AM/PM"
export function to12HourTime(time24: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let hour = parseInt(hStr, 10);
  const minute = mStr || "00";
  if (isNaN(hour)) return time24;

  const period = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;

  return `${hour}:${minute.padStart(2, "0")} ${period}`;
}

export const ClockTimePicker: React.FC<ClockTimePickerProps> = ({
  value,
  onChange,
  label,
  placeholder = "Select time",
  disabled = false,
  className,
  required = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const time24 = to24HourTime(value);

  const handleOpenPicker = () => {
    if (disabled) return;
    try {
      inputRef.current?.showPicker?.();
    } catch {
      inputRef.current?.focus();
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-primary" />
          {label}
        </Label>
      )}
      <div
        onClick={handleOpenPicker}
        className={cn(
          "relative flex items-center rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors cursor-pointer group",
          "hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary focus-within:border-primary",
          disabled && "opacity-50 cursor-not-allowed bg-muted/40"
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            handleOpenPicker();
          }}
          className="mr-2.5 p-1 rounded-lg text-primary/70 group-hover:text-primary transition-colors hover:bg-primary/10"
          title="Open Clock"
        >
          <Clock className="w-4 h-4" />
        </button>

        <input
          ref={inputRef}
          type="time"
          value={time24}
          disabled={disabled}
          required={required}
          onChange={(e) => {
            const raw24 = e.target.value;
            onChange(raw24 ? to12HourTime(raw24) : "");
          }}
          className="w-full bg-transparent font-bold text-sm tracking-wide text-foreground focus:outline-none cursor-pointer [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-80 hover:[&::-webkit-calendar-picker-indicator]:opacity-100"
          placeholder={placeholder}
        />

        {time24 && (
          <span className="hidden sm:inline-block ml-2 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-black uppercase tracking-wider shrink-0 pointer-events-none">
            {to12HourTime(time24)}
          </span>
        )}
      </div>
    </div>
  );
};
