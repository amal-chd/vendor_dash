import { useState, useId } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { adminActionToast } from "@/lib/admin-ops";
import { toast } from "sonner";
import {
  KeyRound,
  Copy,
  Check,
  Send,
  Eye,
  EyeOff,
  Sparkles,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Mail,
  Share2,
} from "lucide-react";

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  } | null;
}

function generateRandomPassword(): string {
  const words = ["Kada", "Spice", "Taste", "Chef", "Dine", "Royal", "Prime", "Fast"];
  const randomWord = words[Math.floor(Math.random() * words.length)];
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const specials = ["#", "!", "@", "$"];
  const randomSpecial = specials[Math.floor(Math.random() * specials.length)];
  return `${randomWord}${randomSpecial}${randomNum}`;
}

export function ResetPasswordDialog({
  open,
  onOpenChange,
  vendor,
}: ResetPasswordDialogProps) {
  const [activeTab, setActiveTab] = useState<"link" | "set" | "email">("link");
  const [emailInput, setEmailInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [lastSetPassword, setLastSetPassword] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCreds, setCopiedCreds] = useState(false);

  // Sync email when vendor changes
  const targetEmail = emailInput || vendor?.email || "";

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setGeneratedLink(null);
      setLastSetPassword(null);
      setNewPassword("");
      setEmailInput("");
    }
    onOpenChange(isOpen);
  };

  const handleGenerateLink = async () => {
    if (!vendor) return;
    setLoading(true);
    try {
      const res: any = await adminActionToast(
        "resetVendorPassword",
        {
          restaurantId: vendor.id,
          mode: "generate_link",
          email: targetEmail,
        },
        "Password reset link created!",
      );
      if (res?.link) {
        setGeneratedLink(res.link);
      }
    } catch {
      // toast already shown by adminActionToast
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!vendor) return;
    if (!targetEmail) {
      toast.error("Please enter a valid vendor email address.");
      return;
    }
    setLoading(true);
    try {
      const res: any = await adminActionToast(
        "resetVendorPassword",
        {
          restaurantId: vendor.id,
          mode: "send_email",
          email: targetEmail,
        },
        `Password reset email sent to ${targetEmail}`,
      );
      if (res?.link) {
        setGeneratedLink(res.link);
      }
    } catch {
      // toast already shown
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async () => {
    if (!vendor) return;
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters long.");
      return;
    }
    setLoading(true);
    try {
      await adminActionToast(
        "resetVendorPassword",
        {
          restaurantId: vendor.id,
          mode: "set_password",
          newPassword,
          email: targetEmail,
        },
        `Password successfully updated for ${vendor.name}!`,
      );
      setLastSetPassword(newPassword);
    } catch {
      // toast already shown
    } finally {
      setLoading(false);
    }
  };

  const copyResetLink = () => {
    if (!generatedLink) return;
    navigator.clipboard.writeText(generatedLink);
    setCopiedLink(true);
    toast.success("Password reset link copied to clipboard");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyCredentials = () => {
    if (!vendor || !lastSetPassword) return;
    const credText = [
      `🔐 Kada Dine Vendor Credentials`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Business: ${vendor.name}`,
      `Login Email: ${targetEmail}`,
      `Temporary Password: ${lastSetPassword}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Login Portal: https://vendor.thekada.in/login`,
      `Please change your password immediately after logging in.`,
    ].join("\n");

    navigator.clipboard.writeText(credText);
    setCopiedCreds(true);
    toast.success("Credentials formatted and copied to clipboard!");
    setTimeout(() => setCopiedCreds(false), 2000);
  };

  const openWhatsApp = () => {
    if (!vendor) return;
    const phone = (vendor.phone || "").replace(/[^0-9]/g, "");
    const message = encodeURIComponent(
      `Hello ${vendor.name},\nHere is your password reset link for Kada Dine Admin Portal:\n${generatedLink}\n\nPlease click the link to choose a new password.`
    );
    window.open(`https://wa.me/${phone}?text=${message}`, "_blank");
  };

  if (!vendor) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Reset Vendor Password
              </DialogTitle>
              <DialogDescription className="text-xs">
                Manage login credentials & password access for <strong className="text-foreground">{vendor.name}</strong>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Vendor summary info pill */}
        <div className="bg-muted/50 rounded-xl p-3 border text-xs space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Vendor:</span>
            <span className="font-semibold text-foreground">{vendor.name}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Registered Email:</span>
            <span className="font-mono text-foreground">{vendor.email || "—"}</span>
          </div>
          {vendor.phone && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Phone:</span>
              <span className="text-foreground">{vendor.phone}</span>
            </div>
          )}
        </div>

        {/* Email override input if needed */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Target Login Email</span>
            {emailInput && emailInput !== vendor.email && (
              <span className="text-[10px] text-amber-600 font-medium">(custom override)</span>
            )}
          </Label>
          <Input
            type="email"
            placeholder={vendor.email || "vendor@example.com"}
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        {/* Action Tabs */}
        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-9">
            <TabsTrigger value="link" className="text-xs">Generate Link</TabsTrigger>
            <TabsTrigger value="set" className="text-xs">Set Password</TabsTrigger>
            <TabsTrigger value="email" className="text-xs">Send Email</TabsTrigger>
          </TabsList>

          {/* TAB 1: GENERATE RESET LINK */}
          <TabsContent value="link" className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Generate a one-time Firebase Auth password reset link to share with the vendor directly via WhatsApp, SMS, or phone.
            </p>

            {generatedLink ? (
              <div className="space-y-2.5 p-3 rounded-xl border bg-emerald-500/5 border-emerald-500/20">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-600">
                  <span>Reset Link Generated!</span>
                  <span className="text-[10px] text-muted-foreground">Expires in 1 hr</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={generatedLink}
                    className="h-8 text-xs font-mono bg-background"
                  />
                  <Button
                    size="sm"
                    className="h-8 px-3 shrink-0 gap-1.5"
                    onClick={copyResetLink}
                  >
                    {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedLink ? "Copied" : "Copy"}
                  </Button>
                </div>
                {vendor.phone && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openWhatsApp}
                    className="w-full h-8 text-xs gap-1.5 border-emerald-600/30 text-emerald-700 hover:bg-emerald-50"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share via WhatsApp (+{vendor.phone.replace(/[^0-9]/g, "")})
                  </Button>
                )}
              </div>
            ) : (
              <Button
                onClick={handleGenerateLink}
                disabled={loading}
                className="w-full h-9 text-xs gap-2"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                Generate Secure Reset Link
              </Button>
            )}
          </TabsContent>

          {/* TAB 2: SET PASSWORD DIRECTLY */}
          <TabsContent value="set" className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Set a new temporary password immediately. This updates their Firebase Auth record and revokes all active login sessions.
            </p>

            {lastSetPassword ? (
              <div className="space-y-2.5 p-3 rounded-xl border bg-emerald-500/5 border-emerald-500/20">
                <div className="text-xs font-semibold text-emerald-600">
                  Password Updated Successfully!
                </div>
                <div className="p-2.5 rounded-lg bg-background border text-xs font-mono space-y-1">
                  <div><span className="text-muted-foreground">Email:</span> {targetEmail}</div>
                  <div><span className="text-muted-foreground">Password:</span> {lastSetPassword}</div>
                </div>
                <Button
                  onClick={copyCredentials}
                  className="w-full h-8 text-xs gap-1.5"
                  variant="outline"
                >
                  {copiedCreds ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedCreds ? "Copied Credentials" : "Copy Credentials Template"}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">New Temporary Password</Label>
                    <button
                      type="button"
                      onClick={() => setNewPassword(generateRandomPassword())}
                      className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                    >
                      <Sparkles className="h-3 w-3" /> Generate Password
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Minimum 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-9 text-xs pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 text-amber-700 text-[11px]">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Existing vendor sessions on other devices will be terminated immediately.</span>
                </div>

                <Button
                  onClick={handleSetPassword}
                  disabled={loading || newPassword.length < 6}
                  className="w-full h-9 text-xs gap-2"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save New Password & Revoke Sessions
                </Button>
              </div>
            )}
          </TabsContent>

          {/* TAB 3: SEND OFFICIAL EMAIL */}
          <TabsContent value="email" className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Send an automated password reset email directly to <strong className="text-foreground">{targetEmail}</strong> via Firebase Authentication.
            </p>

            <Button
              onClick={handleSendEmail}
              disabled={loading || !targetEmail}
              className="w-full h-9 text-xs gap-2"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send Password Reset Email
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t pt-3 mt-2">
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
