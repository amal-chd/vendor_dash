import React, { useMemo } from "react";
import { Clock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { to24HourTime, to12HourTime } from "./ClockTimePicker";

export interface OpeningHoursClockPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
}

const PRESETS = [
  { label: "Standard", open: "09:00 AM", close: "10:00 PM" },
  { label: "Extended", open: "08:00 AM", close: "11:00 PM" },
  { label: "Lunch & Dinner", open: "11:00 AM", close: "11:00 PM" },
  { label: "Late Night", open: "12:00 PM", close: "12:00 AM" },
  { label: "24 Hours", open: "12:00 AM", close: "11:59 PM" },
];

export const OpeningHoursClockPicker: React.FC<OpeningHoursClockPickerProps> = ({
  value,
  onChange,
  label = "Opening Hours",
  disabled = false,
  className,
  required = false,
}) => {
  // Parse existing string like "09:00 AM – 10:00 PM" or "9 TO 10" or "09:00 - 22:00"
  const { openTime, closeTime } = useMemo(() => {
    if (!value) return { openTime: "", closeTime: "" };

    const delimiters = [" – ", " - ", " to ", " TO ", " to", " -", "-"];
    let parts: string[] = [];

    for (const d of delimiters) {
      if (value.includes(d)) {
        parts = value.split(d).map((s) => s.trim());
        break;
      }
    }

    if (parts.length < 2) {
      // Single fallback
      return { openTime: value, closeTime: "" };
    }

    // Format both parts to 24h
    let open24 = to24HourTime(parts[0]);
    let close24 = to24HourTime(parts[1]);

    // Handle bare numbers e.g. "9" or "10"
    if (!open24 && /^\d{1,2}$/.test(parts[0])) {
      const h = parseInt(parts[0], 10);
      open24 = `${String(h < 12 ? h : h).padStart(2, "0")}:00`;
    }
    if (!close24 && /^\d{1,2}$/.test(parts[1])) {
      let h = parseInt(parts[1], 10);
      // If close hour is smaller than open hour (e.g. 9 to 10), assume PM if appropriate
      if (h <= 11) h += 12;
      close24 = `${String(h).padStart(2, "0")}:00`;
    }

    return {
      openTime: open24,
      closeTime: close24,
    };
  }, [value]);

  const updateHours = (newOpen24: string, newClose24: string) => {
    if (!newOpen24 && !newClose24) {
      onChange("");
      return;
    }
    const openFormatted = newOpen24 ? to12HourTime(newOpen24) : "12:00 AM";
    const closeFormatted = newClose24 ? to12HourTime(newClose24) : "11:59 PM";
    onChange(`${openFormatted} – ${closeFormatted}`);
  };

  const handleOpenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateHours(e.target.value, closeTime);
  };

  const handleCloseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateHours(openTime, e.target.value);
  };

  const handleSelectPreset = (preset: typeof PRESETS[0]) => {
    const o24 = to24HourTime(preset.open);
    const c24 = to24HourTime(preset.close);
    updateHours(o24, c24);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-primary" />
          {label} {required && <span className="text-destructive">*</span>}
        </Label>
        {value && (
          <span className="text-[11px] font-black text-primary px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20">
            {value}
          </span>
        )}
      </div>

      {/* Two Clock Inputs: Opens At & Closes At */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Opens At */}
        <div className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70 px-1">
            Opens At
          </span>
          <div className="relative flex items-center rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary focus-within:border-primary">
            <Clock className="w-4 h-4 text-primary mr-2.5 shrink-0 pointer-events-none" />
            <input
              type="time"
              value={openTime}
              onChange={handleOpenChange}
              disabled={disabled}
              required={required}
              className="w-full bg-transparent font-bold text-sm tracking-wide text-foreground focus:outline-none cursor-pointer"
            />
          </div>
        </div>

        {/* Closes At */}
        <div className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70 px-1">
            Closes At
          </span>
          <div className="relative flex items-center rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-primary/50 focus-within:ring-2 focus-within:ring-primary focus-within:border-primary">
            <Clock className="w-4 h-4 text-primary mr-2.5 shrink-0 pointer-events-none" />
            <input
              type="time"
              value={closeTime}
              onChange={handleCloseChange}
              disabled={disabled}
              required={required}
              className="w-full bg-transparent font-bold text-sm tracking-wide text-foreground focus:outline-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Quick Timing Presets */}
      <div className="space-y-1.5 pt-1">
        <span className="text-[10px] font-bold text-muted-foreground/60 flex items-center gap-1 px-1">
          <Sparkles className="w-3 h-3 text-primary/70" /> Quick schedule presets
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const formatted = `${p.open} – ${p.close}`;
            const isSelected = value === formatted;
            return (
              <button
                type="button"
                key={p.label}
                disabled={disabled}
                onClick={() => handleSelectPreset(p)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all border",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {p.label} ({p.open.split(" ")[0]} - {p.close.split(" ")[0]} {p.close.split(" ")[1]})
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
