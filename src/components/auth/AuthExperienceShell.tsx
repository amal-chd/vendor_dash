import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface HighlightItem {
  icon: LucideIcon;
  title: string;
  text: string;
}

export function AuthExperienceShell({
  badge,
  title,
  description,
  highlights,
  children,
}: {
  badge: string;
  title: React.ReactNode;
  description: string;
  highlights: HighlightItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950">
      <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(180deg,_#020617_0%,_#0f172a_48%,_#111827_100%)] lg:flex-row">
        <div className="relative flex w-full overflow-hidden border-b border-white/10 px-6 py-10 lg:w-[46%] lg:border-b-0 lg:border-r lg:px-12 lg:py-14">
          <div className="absolute inset-0">
            <img
              src="/auth-bg.webp"
              alt="Kada Dine ambience"
              className="h-full w-full object-cover opacity-25 mix-blend-screen"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.3)_0%,rgba(2,6,23,0.8)_48%,rgba(2,6,23,1)_100%)]" />
          </div>

          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative z-10 flex w-full flex-col justify-between gap-10"
          >
            <div className="space-y-6">
              <div className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.28em] text-emerald-300">
                {badge}
              </div>
              <div className="space-y-4">
                <h1 className="max-w-xl text-5xl font-black uppercase leading-[0.95] tracking-[-0.06em] text-white sm:text-6xl">
                  {title}
                </h1>
                <p className="max-w-lg text-base font-semibold leading-7 text-slate-300 sm:text-lg">
                  {description}
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              {highlights.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-md"
                >
                  <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-emerald-300">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-black uppercase tracking-[-0.03em] text-white">
                    {item.title}
                  </h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="flex w-full items-center justify-center bg-[linear-gradient(180deg,rgba(248,250,252,1)_0%,rgba(241,245,249,1)_100%)] px-4 py-8 sm:px-6 lg:w-[54%] lg:px-10 lg:py-12">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-2xl"
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
