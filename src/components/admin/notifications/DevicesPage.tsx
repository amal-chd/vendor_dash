import React, { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Smartphone, Monitor, Apple, Trash2, Send } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface Device {
  id: string;
  userId: string;
  deviceModel: string;
  platform: "ios" | "android" | "web";
  app: string;
  isValid: boolean;
  lastSeen: any;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "notification_devices"),
      orderBy("lastSeen", "desc"),
      limit(100),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Device,
        );
        setDevices(data);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        toast.error("Failed to load devices");
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, []);

  const pieData = [
    {
      name: "iOS",
      value: devices.filter((d) => d.platform === "ios").length,
      color: "#3b82f6",
    },
    {
      name: "Android",
      value: devices.filter((d) => d.platform === "android").length,
      color: "#22c55e",
    },
    {
      name: "Web",
      value: devices.filter((d) => d.platform === "web").length,
      color: "#a855f7",
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AdminPageHeader
        title="Device Registry"
        description="Manage push notification tokens and registered devices across all apps."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-6 md:col-span-1 flex flex-col items-center justify-center">
          <h3 className="font-semibold text-sm text-muted-foreground mb-4">
            Platform Distribution
          </h3>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  innerRadius={40}
                  outerRadius={60}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-2 text-xs">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center gap-1">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: d.color }}
                />
                <span>
                  {d.name} ({d.value})
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="md:col-span-3 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : devices.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              No registered devices found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Platform / Model</th>
                    <th className="px-4 py-3 font-medium">User ID</th>
                    <th className="px-4 py-3 font-medium">App</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {devices.map((device) => (
                    <tr key={device.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3 flex items-center gap-3">
                        {device.platform === "ios" ? (
                          <Apple className="h-4 w-4 text-blue-500" />
                        ) : device.platform === "android" ? (
                          <Smartphone className="h-4 w-4 text-green-500" />
                        ) : (
                          <Monitor className="h-4 w-4 text-purple-500" />
                        )}
                        <span className="font-medium">
                          {device.deviceModel || "Unknown Device"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {device.userId}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{device.app}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={device.isValid ? "default" : "destructive"}
                        >
                          {device.isValid ? "Valid Token" : "Invalid Token"}
                        </Badge>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
