import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-[1px] touch-manipulation",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-card hover:-translate-y-0.5 hover:bg-primary/95 hover:shadow-card-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-card hover:-translate-y-0.5 hover:bg-destructive/90",
        outline: "border border-input bg-background/50 shadow-card hover:-translate-y-0.5 hover:bg-accent hover:text-accent-foreground hover:shadow-card-hover",
        secondary: "bg-secondary text-secondary-foreground shadow-card hover:-translate-y-0.5 hover:bg-secondary/90 hover:shadow-card-hover",
        glass: "border border-white/20 bg-white/10 text-foreground dark:text-white shadow-card backdrop-blur hover:-translate-y-0.5 hover:bg-white/20 hover:shadow-card-hover",
        ghost: "hover:bg-accent/80 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-[44px] px-5 py-2.5",
        sm: "min-h-[44px] rounded-lg px-4",
        lg: "min-h-[48px] rounded-xl px-8",
        icon: "min-h-[44px] min-w-[44px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
