import { ArrowRight, BarChart3, ChefHat, QrCode } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";

const heroImage =
  "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1600&q=80";

export function HeroScrollDemo() {
  return (
    <div className="flex flex-col overflow-hidden pb-0 pt-0 md:pb-12 md:pt-4">
      <ContainerScroll
        titleComponent={
          <div className="mx-auto max-w-4xl">


          </div>
        }
      >
        <div className="relative h-full w-full overflow-hidden rounded-2xl bg-[#0f172a]">
          <img
            src={heroImage}
            alt="Restaurant dining space with modern service flow"
            className="h-full w-full object-cover object-center"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-950/80 via-slate-950/30 to-primary/20" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-white/10 bg-slate-950/55 px-4 py-3 text-white backdrop-blur md:px-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">
                Live service view
              </p>
              <p className="mt-1 text-sm font-semibold md:text-base">
                Kada Dine • Friday Dinner Rush
              </p>
            </div>
            <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-200">
              18 active orders
            </div>
          </div>
          <div className="absolute bottom-4 left-4 right-4 grid gap-3 md:bottom-6 md:left-6 md:right-6 md:grid-cols-3">
            {[
              { label: "Kitchen queue", value: "7 tickets", note: "avg wait 12 min" },
              { label: "Tables active", value: "14 / 22", note: "peak floor occupancy" },
              { label: "Today revenue", value: "Rs 48,260", note: "+18% vs yesterday" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-white shadow-2xl backdrop-blur"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-white/60">
                  {stat.label}
                </p>
                <p className="mt-2 text-xl font-semibold md:text-2xl">{stat.value}</p>
                <p className="mt-1 text-xs text-white/70">{stat.note}</p>
              </div>
            ))}
          </div>
        </div>
      </ContainerScroll>
    </div>
  );
}
