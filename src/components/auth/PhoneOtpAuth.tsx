import { useState, useEffect, useRef } from "react";
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult, type User, updateProfile } from "firebase/auth";
import { ArrowRight, ArrowLeft, Loader2, Phone, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { resolvePostAuthPath } from "@/lib/auth-flow";
import { useNavigate } from "react-router-dom";

const COUNTRY_CODES = [
  { code: "+91", label: "🇮🇳 +91 (India)" },
  { code: "+1", label: "🇺🇸 +1 (US/Canada)" },
  { code: "+44", label: "🇬🇧 +44 (UK)" },
  { code: "+971", label: "🇦🇪 +971 (UAE)" },
  { code: "+65", label: "🇸🇬 +65 (Singapore)" },
  { code: "+61", label: "🇦🇺 +61 (Australia)" },
];

interface PhoneOtpAuthProps {
  restaurantName?: string;
  onSuccess?: (user: User) => Promise<void> | void;
}

export function PhoneOtpAuth({ restaurantName, onSuccess }: PhoneOtpAuthProps) {
  const [dialCode, setDialCode] = useState("+91");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const navigate = useNavigate();

  // Handle Resend Countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Safely teardown recaptcha verifier and its DOM container
  const cleanupRecaptcha = () => {
    if (recaptchaVerifierRef.current) {
      try {
        recaptchaVerifierRef.current.clear();
      } catch (err) {
        console.warn("Recaptcha verifier clear warning:", err);
      }
      recaptchaVerifierRef.current = null;
    }
    const container = document.getElementById("recaptcha-verifier-container");
    if (container) {
      container.innerHTML = "";
    }
  };

  // Clean up recaptcha verifier on unmount
  useEffect(() => {
    return () => {
      cleanupRecaptcha();
    };
  }, []);

  const getVerifier = () => {
    if (recaptchaVerifierRef.current) {
      return recaptchaVerifierRef.current;
    }

    let container = document.getElementById("recaptcha-verifier-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "recaptcha-verifier-container";
      document.body.appendChild(container);
    }
    // Wipe any existing children to prevent "already rendered" crash
    container.innerHTML = "";

    // Create a brand new child element that has never been processed by grecaptcha
    const targetEl = document.createElement("div");
    container.appendChild(targetEl);

    const verifier = new RecaptchaVerifier(auth, targetEl, {
      size: "invisible",
      callback: () => {
        // reCAPTCHA solved
      },
      "expired-callback": () => {
        cleanupRecaptcha();
      },
    });

    recaptchaVerifierRef.current = verifier;
    return verifier;
  };

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanNumber = phoneNumber.replace(/\D/g, "");
    if (cleanNumber.length < 7) {
      toast.error("Please enter a valid mobile number.");
      return;
    }

    const fullPhone = `${dialCode}${cleanNumber}`;
    setLoading(true);

    try {
      cleanupRecaptcha();
      const verifier = getVerifier();
      const confirmation = await signInWithPhoneNumber(auth, fullPhone, verifier);
      setConfirmationResult(confirmation);
      setStep("otp");
      setCountdown(30);
      toast.success(`OTP sent to ${fullPhone}`);
    } catch (err: any) {
      console.error("Phone auth error:", err);
      cleanupRecaptcha();

      let msg = "Failed to send OTP. Please try again.";
      if (err?.code === "auth/invalid-phone-number") {
        msg = "Invalid phone number format. Please ensure correct country code.";
      } else if (err?.code === "auth/too-many-requests") {
        msg = "Too many attempts. Please wait a few minutes before trying again.";
      } else if (err?.code === "auth/quota-exceeded") {
        msg = "Daily SMS quota reached. Please sign in using Google or Work Email.";
      } else if (err?.code === "auth/operation-not-allowed") {
        msg = "Phone Authentication is not enabled in Firebase Console. Please enable Phone provider in Firebase Authentication.";
      } else if (err?.code === "auth/captcha-check-failed") {
        msg = "reCAPTCHA verification check failed. Please refresh and try again.";
      } else if (err?.message) {
        msg = err.message;
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.trim().length !== 6) {
      toast.error("Please enter the complete 6-digit OTP.");
      return;
    }

    if (!confirmationResult) {
      toast.error("Session expired. Please request a new OTP.");
      setStep("phone");
      return;
    }

    setLoading(true);
    try {
      const userCredential = await confirmationResult.confirm(otp.trim());
      if (restaurantName && userCredential.user) {
        try {
          await updateProfile(userCredential.user, {
            displayName: restaurantName.trim(),
          });
        } catch {
          /* non-fatal */
        }
      }

      toast.success("Phone verified successfully!");
      if (onSuccess) {
        await onSuccess(userCredential.user);
      } else {
        const nextPath = await resolvePostAuthPath(userCredential.user);
        navigate(nextPath, { replace: true });
      }
    } catch (err: any) {
      console.error("OTP verification error:", err);
      let msg = "Incorrect OTP code. Please check and try again.";
      if (err?.code === "auth/code-expired") {
        msg = "OTP has expired. Please request a new one.";
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      {/* Invisible container required for Firebase Phone Auth Recaptcha */}
      <div id="recaptcha-verifier-container" />

      <AnimatePresence mode="wait">
        {step === "phone" ? (
          <motion.form
            key="phone-step"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            onSubmit={handleSendOtp}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label
                htmlFor="phone-input"
                className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500"
              >
                Mobile Phone Number
              </label>

              <div className="flex items-center gap-2">
                <select
                  value={dialCode}
                  onChange={(e) => setDialCode(e.target.value)}
                  className="h-12 px-3 rounded-2xl border border-slate-200 bg-slate-50 text-[14px] font-bold text-slate-800 outline-none focus:border-blue-500/60 focus:bg-white transition-all cursor-pointer"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <div className="relative flex-1">
                  <input
                    id="phone-input"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="98765 43210"
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full h-12 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-[15px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                  />
                  <Phone className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 w-full h-12 rounded-2xl bg-blue-600 text-white text-[15px] font-black tracking-wide shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-700/25 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending OTP…
                </>
              ) : (
                <>
                  Get Verification Code
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </motion.form>
        ) : (
          <motion.form
            key="otp-step"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            onSubmit={handleVerifyOtp}
            className="space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="otp-input"
                  className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-500"
                >
                  Enter 6-Digit Code
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setOtp("");
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1"
                >
                  <ArrowLeft className="w-3 h-3" /> Change {dialCode} {phoneNumber}
                </button>
              </div>

              <div className="relative">
                <input
                  id="otp-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  autoFocus
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  className="w-full h-14 px-4 text-center text-2xl font-black tracking-[0.4em] rounded-2xl border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-300 outline-none focus:border-blue-500/60 focus:bg-white focus:ring-4 focus:ring-blue-500/8 transition-all"
                />
              </div>

              <p className="text-xs text-slate-500 text-center font-medium">
                Sent to <span className="font-bold text-slate-800">{dialCode} {phoneNumber}</span>
              </p>
            </div>

            <Button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="mt-2 w-full h-12 rounded-2xl bg-blue-600 text-white text-[15px] font-black tracking-wide shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-700/25 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Verify &amp; Sign In
                </>
              )}
            </Button>

            <div className="pt-2 text-center">
              {countdown > 0 ? (
                <span className="text-xs text-slate-400 font-medium">
                  Resend OTP in <strong className="text-slate-700 font-bold">{countdown}s</strong>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleSendOtp()}
                  className="text-xs text-blue-600 hover:text-blue-700 font-bold inline-flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Resend Verification Code
                </button>
              )}
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
