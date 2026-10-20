import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.82 12.23c0-.73-.06-1.43-.2-2.1H12v3.97h5.5a4.7 4.7 0 0 1-2.04 3.09v2.56h3.3c1.93-1.78 3.06-4.4 3.06-7.52Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.76 0 5.08-.92 6.77-2.5l-3.3-2.56c-.92.62-2.08 1-3.47 1-2.67 0-4.93-1.8-5.74-4.22H2.85v2.65A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.26 13.72A5.98 5.98 0 0 1 5.94 12c0-.6.1-1.18.32-1.72V7.63H2.85A10 10 0 0 0 2 12c0 1.61.38 3.13.85 4.37l3.41-2.65Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.97c1.5 0 2.84.52 3.9 1.52l2.93-2.93C17.07 2.9 14.75 2 12 2A10 10 0 0 0 2.85 7.63l3.41 2.65c.81-2.42 3.07-4.31 5.74-4.31Z"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.07 1.72-.94 2.74 1.01.08 2.03-.49 2.65-1.24Z" />
    </svg>
  );
}

export function SocialAuthButtons({
  loading,
  onGoogle,
  onApple,
  emphasis = "continue",
}: {
  loading: boolean;
  onGoogle: () => void;
  onApple?: () => void;
  emphasis?: "continue" | "join";
}) {
  const actionText = emphasis === "join" ? "register" : "sign in";

  return (
    <div className="space-y-4">
      <div className={`grid ${onApple ? "grid-cols-2" : "grid-cols-1"} gap-3`}>
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={onGoogle}
          className="h-12 w-full rounded-2xl border border-slate-200 bg-white font-bold text-slate-800 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all gap-2 text-[14px]"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : (
            <GoogleMark />
          )}
          Google
        </Button>

        {onApple && (
          <Button
            type="button"
            disabled={loading}
            onClick={onApple}
            className="h-12 w-full rounded-2xl border border-slate-900 bg-slate-900 text-white font-bold shadow-sm hover:bg-slate-800 transition-all gap-2 text-[14px]"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            ) : (
              <AppleMark />
            )}
            Apple
          </Button>
        )}
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
            Or {actionText} with
          </span>
        </div>
      </div>
    </div>
  );
}
