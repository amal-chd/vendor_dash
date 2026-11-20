import React, { useState } from "react";
import { format, parseISO, isValid } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";

export interface CalendarDatePickerProps {
  value: string; // "YYYY-MM-DD" or ISO string
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  minDate?: Date;
  maxDate?: Date;
  required?: boolean;
}

export const CalendarDatePicker: React.FC<CalendarDatePickerProps> = ({
  value,
  onChange,
  label,
  placeholder = "Pick a date",
  disabled = false,
  className,
  buttonClassName,
  minDate,
  maxDate,
  required = false,
}) => {
  const [open, setOpen] = useState(false);

  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    try {
      const d = parseISO(value.includes("T") ? value.split("T")[0] : value);
      return isValid(d) ? d : undefined;
    } catch {
      return undefined;
    }
  }, [value]);

  const handleSelectDate = (date: Date | undefined) => {
    if (!date) {
      onChange("");
    } else {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      onChange(`${yyyy}-${mm}-${dd}`);
    }
    setOpen(false);
  };

  const handleQuickPreset = (daysOffset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    handleSelectDate(d);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <CalendarIcon className="w-3.5 h-3.5 text-primary" />
          {label} {required && <span className="text-destructive">*</span>}
        </Label>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full h-11 justify-start text-left font-bold rounded-xl bg-card border-input px-3 shadow-sm transition-colors hover:border-primary/50",
              !selectedDate && "text-muted-foreground font-normal",
              open && "ring-2 ring-primary border-primary",
              buttonClassName
            )}
          >
            <CalendarIcon className="mr-2.5 h-4 w-4 text-primary shrink-0" />
            <span className="flex-1 truncate text-sm">
              {selectedDate ? format(selectedDate, "PPP") : placeholder}
            </span>
            {selectedDate && !disabled && (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectDate(undefined);
                }}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-auto p-0 rounded-2xl border-border/40 shadow-2xl bg-card z-50" align="start">
          <div className="p-3 border-b border-border/20 flex items-center justify-between gap-1.5 bg-muted/20">
            <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
              Quick Selection
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleQuickPreset(0)}
                className="px-2 py-1 rounded-md text-[10px] font-bold bg-card border border-border/40 hover:bg-muted text-foreground transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(1)}
                className="px-2 py-1 rounded-md text-[10px] font-bold bg-card border border-border/40 hover:bg-muted text-foreground transition-colors"
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(7)}
                className="px-2 py-1 rounded-md text-[10px] font-bold bg-card border border-border/40 hover:bg-muted text-foreground transition-colors"
              >
                +7 Days
              </button>
            </div>
          </div>

          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelectDate}
            fromDate={minDate}
            toDate={maxDate}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};
