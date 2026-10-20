import React, { useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Search, User, Settings2, Bell, Mail, Smartphone } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface Preferences {
  userId: string;
  categories: {
    orders: { push: boolean; email: boolean; inApp: boolean };
    promotions: { push: boolean; email: boolean; inApp: boolean };
    security: { push: boolean; email: boolean; inApp: boolean };
  };
}

export default function PreferencesPage() {
  const [searchId, setSearchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchId.trim()) return;
    setLoading(true);
    try {
      const docRef = doc(db, "notification_preferences", searchId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setPrefs({ userId: docSnap.id, ...docSnap.data() } as Preferences);
        toast.success("Preferences loaded");
      } else {
        toast.error("No preferences found for this user");
        setPrefs(null);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load preferences");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <AdminPageHeader
        title="User Preferences"
        description="View and override individual user notification preferences."
      />

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by User ID..."
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Searching..." : "Search"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="p-6 space-y-4">
          <Skeleton className="h-64 w-full" />
        </Card>
      ) : prefs ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5" /> User Profile
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 text-sm">
                <div>
                  <span className="text-muted-foreground">User ID:</span>
                  <p className="font-medium break-all">{prefs.userId}</p>
                </div>

              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings2 className="h-5 w-5" /> Notification Settings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {Object.entries(prefs.categories || {}).map(
                  ([cat, channels]) => (
                    <div key={cat} className="space-y-3">
                      <h4 className="font-semibold capitalize border-b pb-2">
                        {cat}
                      </h4>
                      <div className="flex gap-6">
                        <div className="flex items-center gap-2">
                          <Bell
                            className={`h-4 w-4 ${channels.push ? "text-primary" : "text-muted-foreground"}`}
                          />
                          <span className="text-sm">
                            Push: {channels.push ? "On" : "Off"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Mail
                            className={`h-4 w-4 ${channels.email ? "text-primary" : "text-muted-foreground"}`}
                          />
                          <span className="text-sm">
                            Email: {channels.email ? "On" : "Off"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Smartphone
                            className={`h-4 w-4 ${channels.inApp ? "text-primary" : "text-muted-foreground"}`}
                          />
                          <span className="text-sm">
                            In-App: {channels.inApp ? "On" : "Off"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ),
                )}

                {(!prefs.categories ||
                  Object.keys(prefs.categories).length === 0) && (
                  <p className="text-sm text-muted-foreground italic">
                    No category preferences recorded. User receives defaults.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed rounded-xl text-muted-foreground">
          <Search className="h-8 w-8 mb-4 opacity-50" />
          <p>Search for a user to view their notification preferences.</p>
        </div>
      )}
    </div>
  );
}
