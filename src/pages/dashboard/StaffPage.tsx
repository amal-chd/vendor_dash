import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Users, UserPlus, Shield,
  ChefHat, Banknote, LayoutDashboard,
  Clock, Mail, Phone, Search,
  Zap, TrendingUp, History, Trash2,
  Calendar, CheckCircle2,
  Plus, RefreshCw, TrendingDown,
  Activity, Sparkles, Eye, EyeOff,
  Download, AlertTriangle, UserX
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";

import { toast } from "sonner";
import { db } from "@/lib/firebase";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { 
  collection, query, where, onSnapshot, addDoc, doc, 
  updateDoc, deleteDoc, serverTimestamp, writeBatch, 
  orderBy, limit, Timestamp 
} from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { 
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from "@/components/ui/tabs";

interface StaffMember {
  id: string;
  name: string;
  role: string;
  shift: string;
  status: "Active" | "Off-Duty" | "On Leave" | "Inactive";
  avatar: string;
  performance: string;
  phone?: string;
  email?: string;
  notes?: string;
  hourlyRate?: number;
  restaurantId: string;
  pin?: string;
  timestamp?: any;
}

interface AttendanceRecord {
  id: string;
  restaurantId: string;
  staffId: string;
  staffName: string;
  role: string;
  clockIn: any;
  clockOut: any | null;
  durationMinutes: number | null;
  status: string;
  notes?: string;
}

interface PayrollEntry {
  id: string;
  restaurantId: string;
  staffId: string;
  staffName: string;
  role: string;
  periodStart: any;
  periodEnd: any;
  hoursWorked: number;
  hourlyRate: number;
  gross: number;
  bonus: number;
  deduction: number;
  net: number;
  paidAt: any;
  paymentMode: string;
  expenseId: string;
  notes?: string;
}

const roleConfig: Record<string, { icon: React.ElementType, color: string }> = {
  Manager: { icon: Shield, color: "text-purple-500 bg-purple-500/10 border-purple-500/20" },
  Kitchen: { icon: ChefHat, color: "text-orange-500 bg-orange-500/10 border-orange-500/20" },
  Cashier: { icon: Banknote, color: "text-green-500 bg-green-500/10 border-green-500/20" },
  Admin: { icon: LayoutDashboard, color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
  Waiter: { icon: Users, color: "text-primary bg-primary/10 border-primary/20" },
};

const formatTime = (timestamp: any) => {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const formatDate = (timestamp: any) => {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getDurationHours = (record: AttendanceRecord) => {
  if (record.durationMinutes !== undefined && record.durationMinutes !== null) {
    return record.durationMinutes / 60;
  }
  const clockInDate = record.clockIn instanceof Timestamp ? record.clockIn.toDate() : new Date(record.clockIn);
  const clockOutDate = record.clockOut 
    ? (record.clockOut instanceof Timestamp ? record.clockOut.toDate() : new Date(record.clockOut))
    : new Date();
  return Math.max(0, (clockOutDate.getTime() - clockInDate.getTime()) / (1000 * 60 * 60));
};

export default function StaffPage() {
  const { user, activeRestaurantId, isStaffOutlet } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedRole, setSelectedRole] = useState("All");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [attendanceStaffFilter, setAttendanceStaffFilter] = useState("all");

  // Subscriptions for KPIs
  const [activeAttendance, setActiveAttendance] = useState<AttendanceRecord[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([]);
  const [monthPayrollSum, setMonthPayrollSum] = useState(0);

  // Attendance Tab States
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);

  // Payroll Tab States
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [periodEnd, setPeriodEnd] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [payrollAttendance, setPayrollAttendance] = useState<AttendanceRecord[]>([]);
  const [recentPayroll, setRecentPayroll] = useState<PayrollEntry[]>([]);
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [selectedPayrollStaff, setSelectedPayrollStaff] = useState<StaffMember | null>(null);
  const [payoutDraft, setPayoutDraft] = useState({
    hoursWorked: 0,
    hourlyRate: 0,
    bonus: 0,
    deduction: 0,
    paymentMode: "Bank Transfer",
    notes: ""
  });

  // Edit Staff Details
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "",
    role: "Kitchen",
    shift: "Day Shift",
    status: "Active" as StaffMember["status"],
    phone: "",
    email: "",
    performance: "100%",
    hourlyRate: 0,
    pin: "",
    notes: "",
  });

  // Add Staff inline form state
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("Kitchen");
  const [newShift, setNewShift] = useState("Day Shift");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Day list generator for attendance selector
  const days = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push(d);
    }
    return arr;
  }, []);

  // 1. Staff directory live feed
  useEffect(() => {
    if (!user || !activeRestaurantId) return;

    const q = query(
      collection(db, "staff"),
      where("restaurantId", "==", activeRestaurantId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const staffData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as StaffMember[];
      setStaff(staffData);
      setLoading(false);
    }, (err) => console.error("[StaffPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  // 2. Active check-ins live feed (currently on duty)
  useEffect(() => {
    if (!user || !activeRestaurantId) return;

    const q = query(
      collection(db, "attendance"),
      where("restaurantId", "==", activeRestaurantId),
      where("clockOut", "==", null)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AttendanceRecord[];
      setActiveAttendance(records);
    }, (err) => console.error("[StaffPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  // 3. Today's check-ins live feed (to calculate today's hours)
  useEffect(() => {
    if (!user || !activeRestaurantId) return;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, "attendance"),
      where("restaurantId", "==", activeRestaurantId),
      where("clockIn", ">=", Timestamp.fromDate(todayStart))
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AttendanceRecord[];
      setTodayAttendance(records);
    }, (err) => console.error("[StaffPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  // 4. Monthly payroll sum live feed
  useEffect(() => {
    if (!user || !activeRestaurantId) return;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, "payroll"),
      where("restaurantId", "==", activeRestaurantId),
      where("paidAt", ">=", Timestamp.fromDate(monthStart))
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sum = snapshot.docs.reduce((acc, doc) => {
        const data = doc.data();
        return acc + (Number(data.net) || 0);
      }, 0);
      setMonthPayrollSum(sum);
    }, (err) => console.error("[StaffPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  // 5. Attendance feed for the selected day
  useEffect(() => {
    if (!user || !activeRestaurantId) return;

    const dayStart = new Date(selectedDay);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const q = query(
      collection(db, "attendance"),
      where("restaurantId", "==", activeRestaurantId),
      where("clockIn", ">=", Timestamp.fromDate(dayStart)),
      where("clockIn", "<", Timestamp.fromDate(dayEnd))
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AttendanceRecord[];
      records.sort((a, b) => {
        const aTime = a.clockIn?.toDate ? a.clockIn.toDate().getTime() : new Date(a.clockIn).getTime();
        const bTime = b.clockIn?.toDate ? b.clockIn.toDate().getTime() : new Date(b.clockIn).getTime();
        return bTime - aTime;
      });
      setAttendanceRecords(records);
    }, (err) => console.error("[StaffPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId, selectedDay]);

  // 6. Attendance feed for payroll period
  useEffect(() => {
    if (!user || !activeRestaurantId) return;

    const pStart = new Date(periodStart);
    pStart.setHours(0, 0, 0, 0);
    const pEnd = new Date(periodEnd);
    pEnd.setDate(pEnd.getDate() + 1);
    pEnd.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, "attendance"),
      where("restaurantId", "==", activeRestaurantId),
      where("clockIn", ">=", Timestamp.fromDate(pStart)),
      where("clockIn", "<", Timestamp.fromDate(pEnd))
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AttendanceRecord[];
      setPayrollAttendance(records);
    }, (err) => console.error("[StaffPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId, periodStart, periodEnd]);

  // 7. Recent payroll payouts
  useEffect(() => {
    if (!user || !activeRestaurantId) return;

    const q = query(
      collection(db, "payroll"),
      where("restaurantId", "==", activeRestaurantId),
      orderBy("paidAt", "desc"),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const payouts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as PayrollEntry[];
      setRecentPayroll(payouts);
    }, (err) => console.error("[StaffPage] q listener failed", err));

    return () => unsubscribe();
  }, [user, activeRestaurantId]);

  // Aggregate hours worked in current period per staff
  const hoursByStaff = useMemo(() => {
    const map: Record<string, number> = {};
    payrollAttendance.forEach(rec => {
      map[rec.staffId] = (map[rec.staffId] || 0) + getDurationHours(rec);
    });
    return map;
  }, [payrollAttendance]);

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) {
      toast.error("Please enter a name");
      return;
    }
    if (newPhone && !isValidPhoneNumber(newPhone)) {
      toast.error("Please enter a valid phone number");
      return;
    }
    
    setSaving(true);
    try {
      await addDoc(collection(db, "staff"), {
        name: newName,
        role: newRole,
        shift: newShift,
        status: "Active",
        avatar: newName.split(" ").map(n => n[0]).join("").toUpperCase(),
        performance: "100%",
        phone: newPhone.trim(),
        email: newEmail.trim(),
        hourlyRate: 0,
        pin: "0000",
        notes: "",
        restaurantId: activeRestaurantId,
        timestamp: serverTimestamp()
      });
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      toast.success("Staff member added");
    } catch (err) {
      toast.error("Failed to add staff member");
    } finally {
      setSaving(false);
    }
  };

  const openStaffDetails = (person: StaffMember) => {
    setSelectedStaff(person);
    setEditDraft({
      name: person.name || "",
      role: person.role || "Kitchen",
      shift: person.shift || "Day Shift",
      status: person.status || "Active",
      phone: person.phone || "",
      email: person.email || "",
      performance: person.performance || "100%",
      hourlyRate: Number(person.hourlyRate) || 0,
      pin: person.pin || "0000",
      notes: person.notes || "",
    });
    setDetailsOpen(true);
  };

  const saveStaffDetails = async () => {
    if (!selectedStaff) return;
    const name = editDraft.name.trim();
    if (name.length < 2) {
      toast.error("Name is required");
      return;
    }
    if (editDraft.phone && !isValidPhoneNumber(editDraft.phone)) {
      toast.error("Please enter a valid phone number");
      return;
    }
    
    setSaving(true);
    try {
      await updateDoc(doc(db, "staff", selectedStaff.id), {
        name,
        role: editDraft.role,
        shift: editDraft.shift,
        status: editDraft.status,
        phone: editDraft.phone.trim(),
        email: editDraft.email.trim(),
        performance: editDraft.performance,
        hourlyRate: Number(editDraft.hourlyRate) || 0,
        pin: editDraft.pin.trim() || "0000",
        notes: editDraft.notes.trim(),
      });
      toast.success("Staff updated");
      setDetailsOpen(false);
    } catch (e) {
      toast.error("Failed to update staff");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStaff = async (id: string) => {
    if (!confirm("Are you sure? This will archive the staff member and mark them as inactive. Attendance and payroll history will be preserved.")) return;
    try {
      await updateDoc(doc(db, "staff", id), {
        status: "Inactive",
      });
      toast.success("Staff member archived");
    } catch (error) {
      toast.error("Failed to archive staff");
    }
  };

  // Clock In direct action
  const handleClockIn = async (member: StaffMember) => {
    try {
      await addDoc(collection(db, "attendance"), {
        restaurantId: activeRestaurantId,
        staffId: member.id,
        staffName: member.name,
        role: member.role,
        clockIn: serverTimestamp(),
        clockOut: null,
        durationMinutes: null,
        status: 'present'
      });
      toast.success(`${member.name} clocked in successfully`);
    } catch (err) {
      toast.error("Failed to clock in");
    }
  };

  // Clock Out direct action
  const handleClockOut = async (attendanceId: string, clockIn: any) => {
    try {
      const clockInDate = clockIn?.toDate ? clockIn.toDate() : new Date(clockIn);
      const diffMins = Math.round((Date.now() - clockInDate.getTime()) / (1000 * 60));
      
      await updateDoc(doc(db, "attendance", attendanceId), {
        clockOut: serverTimestamp(),
        durationMinutes: diffMins
      });
      toast.success("Clocked out successfully");
    } catch (err) {
      toast.error("Failed to clock out");
    }
  };

  // Run Payroll payouts write
  const handleRunPayroll = async () => {
    if (!selectedPayrollStaff) return;
    
    const gross = payoutDraft.hoursWorked * payoutDraft.hourlyRate;
    const net = gross + payoutDraft.bonus - payoutDraft.deduction;
    if (net <= 0) {
      toast.error("Net payout must be greater than 0");
      return;
    }

    setSaving(true);
    try {
      const batch = writeBatch(db);
      
      const expRef = doc(collection(db, "expenses"));
      batch.set(expRef, {
        restaurantId: activeRestaurantId,
        category: 'Salary',
        amount: net,
        description: `Payroll · ${selectedPayrollStaff.name} (${selectedPayrollStaff.role}) · ${formatDate(new Date(periodStart))} – ${formatDate(new Date(periodEnd))}`,
        date: new Date().toISOString().split("T")[0],
        paymentMode: payoutDraft.paymentMode,
        source: 'payroll',
        sourceId: null,
        staffId: selectedPayrollStaff.id,
        staffName: selectedPayrollStaff.name,
        createdAt: serverTimestamp()
      });

      const payRef = doc(collection(db, "payroll"));
      batch.set(payRef, {
        restaurantId: activeRestaurantId,
        staffId: selectedPayrollStaff.id,
        staffName: selectedPayrollStaff.name,
        role: selectedPayrollStaff.role,
        periodStart: Timestamp.fromDate(new Date(periodStart)),
        periodEnd: Timestamp.fromDate(new Date(periodEnd)),
        hoursWorked: payoutDraft.hoursWorked,
        hourlyRate: payoutDraft.hourlyRate,
        gross,
        bonus: payoutDraft.bonus,
        deduction: payoutDraft.deduction,
        net,
        paidAt: serverTimestamp(),
        paymentMode: payoutDraft.paymentMode,
        expenseId: expRef.id,
        notes: payoutDraft.notes.trim() || null
      });

      await batch.commit();
      toast.success(`Salary of ₹${net.toFixed(0)} successfully paid to ${selectedPayrollStaff.name}`);
      setPayoutDialogOpen(false);
    } catch (err) {
      toast.error("Failed to process payroll payout");
    } finally {
      setSaving(false);
    }
  };

  const filteredStaff = selectedRole === "All"
    ? staff
    : staff.filter(person => person.role === selectedRole);

  const searchedStaff = filteredStaff.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.role || "").toLowerCase().includes(q) ||
      (p.shift || "").toLowerCase().includes(q) ||
      (p.status || "").toLowerCase().includes(q) ||
      (p.phone || "").toLowerCase().includes(q) ||
      (p.email || "").toLowerCase().includes(q)
    );
  });

  const transition = { duration: 0.4, ease: [0.2, 0, 0, 1] as const };

  // Computed KPI: Total hours today across all staff
  const totalHoursToday = useMemo(() => {
    return todayAttendance.reduce((acc, r) => acc + getDurationHours(r), 0);
  }, [todayAttendance]);

  // Computed: Total dues across all staff for payroll period
  const totalDues = useMemo(() => {
    return staff.reduce((sum, member) => {
      const hours = hoursByStaff[member.id] || 0;
      const rate = member.hourlyRate || 0;
      return sum + hours * rate;
    }, 0);
  }, [staff, hoursByStaff]);

  // Filtered attendance records for selected staff
  const filteredAttendanceRecords = useMemo(() => {
    if (attendanceStaffFilter === "all") return attendanceRecords;
    return attendanceRecords.filter(r => r.staffId === attendanceStaffFilter);
  }, [attendanceRecords, attendanceStaffFilter]);

  // CSV Export: Attendance
  const exportAttendanceCSV = () => {
    const rows = filteredAttendanceRecords.map(r => ({
      Name: r.staffName,
      Role: r.role,
      "Clock In": formatTime(r.clockIn),
      "Clock Out": r.clockOut ? formatTime(r.clockOut) : "On Duty",
      "Hours": getDurationHours(r).toFixed(1),
      "Status": r.clockOut ? "Completed" : "Active",
    }));
    const header = Object.keys(rows[0] || {}).join(",");
    const csv = [header, ...rows.map(r => Object.values(r).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_${selectedDay.toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Attendance exported");
  };

  // CSV Export: Payroll
  const exportPayrollCSV = () => {
    const rows = staff.map(member => {
      const hours = hoursByStaff[member.id] || 0;
      const rate = member.hourlyRate || 0;
      return {
        Name: member.name,
        Role: member.role,
        "Hours Worked": hours.toFixed(1),
        "Hourly Rate": rate,
        "Due Amount": (hours * rate).toFixed(0),
      };
    });
    const header = Object.keys(rows[0] || {}).join(",");
    const csv = [header, ...rows.map(r => Object.values(r).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll_${periodStart}_to_${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Payroll exported");
  };

  // Payroll period presets
  const setPayrollPreset = (preset: string) => {
    const now = new Date();
    switch (preset) {
      case "this-week": {
        const start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        setPeriodStart(start.toISOString().split("T")[0]);
        setPeriodEnd(now.toISOString().split("T")[0]);
        break;
      }
      case "this-month": {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        setPeriodStart(start.toISOString().split("T")[0]);
        setPeriodEnd(now.toISOString().split("T")[0]);
        break;
      }
      case "last-month": {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        setPeriodStart(start.toISOString().split("T")[0]);
        setPeriodEnd(end.toISOString().split("T")[0]);
        break;
      }
    }
  };

  // Read-only mode for staff outlet accounts
  const readOnly = isStaffOutlet;

  return (
    <div className="space-y-8 pb-10">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mt-2">
        <div className="space-y-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-foreground tracking-tight uppercase italic line-none">Store <span className="text-primary not-italic">Team</span></h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground font-medium italic opacity-60 flex items-center gap-2">
            <Users className="w-3.5 h-3.5" /> Managing your staff members, attendance, and payroll
          </p>
        </div>
      </div>

      {/* Read-only banner for staff outlet accounts */}
      {readOnly && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-bold">You are viewing in read-only mode. Contact the restaurant owner to manage staff, attendance, and payroll.</p>
        </div>
      )}

      {/* KPI Ribbon Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        <Card className="rounded-[2rem] border border-border/40 bg-card/60 backdrop-blur-2xl p-6 flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Total Team</p>
            <h3 className="text-3xl font-black text-foreground tracking-tight mt-0.5">{staff.filter(s => s.status !== "Inactive").length}</h3>
          </div>
        </Card>

        <Card className="rounded-[2rem] border border-border/40 bg-card/60 backdrop-blur-2xl p-6 flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-500">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Currently On Duty</p>
            <h3 className="text-3xl font-black text-foreground tracking-tight mt-0.5">{activeAttendance.length}</h3>
          </div>
        </Card>

        <Card className="rounded-[2rem] border border-border/40 bg-card/60 backdrop-blur-2xl p-6 flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Hours Today</p>
            <h3 className="text-3xl font-black text-foreground tracking-tight mt-0.5">{totalHoursToday.toFixed(1)}</h3>
          </div>
        </Card>

        <Card className="rounded-[2rem] border border-border/40 bg-card/60 backdrop-blur-2xl p-6 flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500">
            <Banknote className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Payroll (MTD)</p>
            <h3 className="text-3xl font-black text-foreground tracking-tight mt-0.5">₹{monthPayrollSum.toLocaleString()}</h3>
          </div>
        </Card>
      </div>

      <Tabs defaultValue="directory" className="w-full">
        <TabsList className="bg-card/40 backdrop-blur-md p-1 rounded-2xl border border-border/20 h-14 w-full sm:w-fit mb-8 gap-1">
          <TabsTrigger value="directory" className="rounded-xl px-6 h-11 font-black text-xs uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
            Team Directory
          </TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-xl px-6 h-11 font-black text-xs uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
            Attendance Logs
          </TabsTrigger>
          <TabsTrigger value="payroll" className="rounded-xl px-6 h-11 font-black text-xs uppercase tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
            Payroll & Salaries
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Staff Directory */}
        <TabsContent value="directory" className="focus-visible:outline-none">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            {/* Left column: Filters & Staff Grid */}
            <div className="xl:col-span-8 space-y-8">
              {/* Roles Filter and Search */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 hide-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
                  {["All", "Manager", "Kitchen", "Cashier", "Admin", "Waiter"].map((role) => (
                    <button
                      key={role}
                      onClick={() => setSelectedRole(role)}
                      className={cn(
                        "px-5 py-2 rounded-full text-[9px] font-black uppercase tracking-[0.2em] transition-all border whitespace-nowrap",
                        selectedRole === role
                          ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30"
                          : "bg-card/40 backdrop-blur-md text-muted-foreground border-border/40 hover:border-primary/50 hover:bg-card/60"
                      )}
                    >
                      {role}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64 group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    placeholder="Search staff..."
                    className="pl-11 pr-4 h-11 bg-card/40 backdrop-blur-xl border-border/40 rounded-xl font-black text-[10px] uppercase tracking-widest focus:ring-primary focus-visible:ring-offset-0 focus-visible:ring-1"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Staff Grid */}
              {loading ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground font-black text-sm uppercase tracking-widest">Loading team vault...</div>
              ) : searchedStaff.length === 0 ? (
                <div className="col-span-full py-20 text-center flex flex-col items-center justify-center">
                  <div className="w-20 h-20 rounded-3xl bg-muted/40 flex items-center justify-center mb-6">
                    <Users className="w-10 h-10 text-muted-foreground/40" />
                  </div>
                  <h3 className="text-lg font-black uppercase tracking-wide text-muted-foreground mb-2">
                    {staff.length === 0 ? "No Team Members Yet" : "No Results Found"}
                  </h3>
                  <p className="text-sm text-muted-foreground/60 font-medium max-w-sm">
                    {staff.length === 0
                      ? "Add your first team member using the form on the right to start managing your staff."
                      : "Try adjusting your search or filter to find the staff member you're looking for."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <AnimatePresence mode="popLayout">
                    {searchedStaff.map((person, i) => {
                      const Config = roleConfig[person.role] || roleConfig.Kitchen;
                      
                      // Calculate active status and hours
                      const activeRecord = activeAttendance.find(r => r.staffId === person.id);
                      const isOnDuty = !!activeRecord;
                      
                      const todayRecs = todayAttendance.filter(r => r.staffId === person.id);
                      const todayHours = todayRecs.reduce((acc, curr) => acc + getDurationHours(curr), 0);

                      return (
                        <motion.div
                          key={person.id}
                          layout
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ ...transition, delay: i * 0.05 }}
                          className="group bg-card/40 backdrop-blur-2xl border border-border/30 rounded-[2rem] p-6 hover:shadow-2xl hover:border-primary/20 hover:-translate-y-1 transition-all relative overflow-hidden flex flex-col justify-between"
                        >
                          <div>
                            {/* Delete action overlay */}
                            {!readOnly && (
                            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteStaff(person.id);
                                }}
                                className="w-8 h-8 rounded-full bg-destructive/10 hover:bg-destructive hover:text-white transition-colors flex items-center justify-center text-destructive backdrop-blur-md"
                              >
                                <UserX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            )}

                            <div className="flex items-center gap-4 mb-6" onClick={() => openStaffDetails(person)} role="button">
                              <div className={cn("relative w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl shadow-inner bg-gradient-to-br from-background to-muted border", Config.color)}>
                                <div className="absolute inset-0 rounded-2xl bg-current opacity-10" />
                                {person.avatar}
                                {isOnDuty && (
                                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-green-500 border-2 border-background animate-pulse shadow-lg" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xl font-black text-foreground tracking-tight truncate uppercase italic">{person.name}</h4>
                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                  <div className={cn("px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border shadow-sm", Config.color)}>
                                    {person.role}
                                  </div>
                                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-muted/80 text-muted-foreground border border-border/50 shadow-sm">
                                    <span className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]", person.status === 'Active' ? 'bg-green-500 shadow-green-500/50' : 'bg-amber-500 shadow-amber-500/50')} />
                                    {person.status}
                                  </div>
                                </div>
                                {person.timestamp && (
                                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 mt-1.5">
                                    Joined: {formatDate(person.timestamp)}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                              <div className="p-4 rounded-[1.5rem] bg-muted/40 border border-border/30 flex flex-col justify-center backdrop-blur-sm">
                                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-70 mb-1.5">Hourly Rate</p>
                                <div className="flex items-center gap-2">
                                  <span className="w-4 h-4 text-primary opacity-80 font-black text-sm flex items-center justify-center">₹</span>
                                  <p className="text-xs font-bold text-foreground">₹{person.hourlyRate || 0}/hr</p>
                                </div>
                              </div>
                              <div className="p-4 rounded-[1.5rem] bg-muted/40 border border-border/30 flex flex-col justify-center backdrop-blur-sm">
                                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-70 mb-1.5">Hours Today</p>
                                <div className="flex items-center gap-2">
                                  <Clock className="w-4 h-4 text-amber-500 opacity-80" />
                                  <p className="text-xs font-black text-foreground">{todayHours.toFixed(1)} hrs</p>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Clock In / Out Actions Row */}
                          <div className="mt-2 pt-4 border-t border-border/20 flex gap-2">
                            <Button 
                              disabled={readOnly}
                              onClick={() => {
                                if (isOnDuty && activeRecord) {
                                  handleClockOut(activeRecord.id, activeRecord.clockIn);
                                } else {
                                  handleClockIn(person);
                                }
                              }}
                              className={cn(
                                "flex-1 h-10 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all",
                                isOnDuty 
                                  ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20" 
                                  : "bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-500/20"
                              )}
                            >
                              {isOnDuty ? "Clock Out" : "Clock In"}
                            </Button>
                            <Button 
                              variant="outline"
                              onClick={() => openStaffDetails(person)}
                              className="w-10 h-10 rounded-xl border-border/40 hover:bg-muted/50 p-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                            >
                              <Clock className="w-4 h-4" />
                            </Button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Right column: Form & Highlights */}
            <div className="xl:col-span-4 space-y-6">
              {/* Add Staff Inline Form */}
              {!readOnly && (
              <Card className="rounded-[2rem] border border-border/40 shadow-xl bg-card/60 backdrop-blur-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-primary/10 to-transparent p-6 border-b border-border/20">
                   <h4 className="text-lg font-black tracking-tight text-foreground uppercase italic flex items-center gap-2">
                      <UserPlus className="w-5 h-5 text-primary" /> New Member
                   </h4>
                </div>
                <form onSubmit={handleAddStaff} className="p-6 space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Full Name</label>
                    <Input
                      className="h-11 rounded-xl bg-background/50 border-border/40 font-bold focus:ring-primary focus:border-primary transition-colors text-sm"
                      placeholder="e.g. Jane Smith"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5 [&_.PhoneInputInput]:h-11 [&_.PhoneInputInput]:rounded-xl [&_.PhoneInputInput]:bg-background/50 [&_.PhoneInputInput]:border [&_.PhoneInputInput]:border-border/40 [&_.PhoneInputInput]:font-bold [&_.PhoneInputInput]:focus:ring-primary [&_.PhoneInputInput]:focus:border-primary [&_.PhoneInputInput]:transition-colors [&_.PhoneInputInput]:text-sm [&_.PhoneInputInput]:px-3">
                      <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Phone</label>
                      <PhoneInput
                        maxLength={15}
                        international
                        defaultCountry="IN"
                        value={newPhone}
                        onChange={(val) => setNewPhone(val || "")}
                        className="w-full font-bold text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Email</label>
                      <Input
                        className="h-11 rounded-xl bg-background/50 border-border/40 font-bold focus:ring-primary focus:border-primary transition-colors text-sm"
                        placeholder="name@shop.com"
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                     <div className="space-y-1.5">
                        <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Role</label>
                        <select
                          className="w-full h-11 px-3 rounded-xl bg-background/50 border border-border/40 font-bold text-[10px] uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                          value={newRole}
                          onChange={(e) => setNewRole(e.target.value)}
                        >
                          <option>Kitchen</option>
                          <option>Cashier</option>
                          <option>Manager</option>
                          <option>Admin</option>
                          <option>Waiter</option>
                        </select>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60 px-1">Shift</label>
                        <select
                          className="w-full h-11 px-3 rounded-xl bg-background/50 border border-border/40 font-bold text-[10px] uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                          value={newShift}
                          onChange={(e) => setNewShift(e.target.value)}
                        >
                          <option>Day Shift</option>
                          <option>Night Shift</option>
                          <option>Full Time</option>
                        </select>
                     </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[11px] shadow-lg shadow-primary/25 mt-2 hover:-translate-y-0.5 transition-transform"
                  >
                    {saving ? "Adding..." : "Add Staff"}
                  </Button>
                </form>
              </Card>
              )}

              {/* Workload Distribution */}
              <Card className="rounded-[2rem] border border-border/40 shadow-xl bg-card/60 backdrop-blur-2xl overflow-hidden p-6 sm:p-8">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h3 className="text-lg font-black tracking-tight text-foreground uppercase italic">Team <span className="text-primary not-italic">Allocation</span></h3>
                    <p className="text-[9px] font-bold uppercase tracking-widest opacity-50 italic mt-1.5">Workload distribution</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                     <Activity className="w-4 h-4 text-primary" />
                  </div>
                </div>
                
                <div className="space-y-6">
                  {[
                    { label: "Kitchen Staff", val: staff.filter(s => s.role === 'Kitchen').length, max: 10, bg: "bg-orange-500", grad: "from-orange-500" },
                    { label: "Service Staff", val: staff.filter(s => s.role === 'Cashier' || s.role === 'Waiter').length, max: 10, bg: "bg-green-500", grad: "from-green-500" },
                    { label: "Management", val: staff.filter(s => s.role === 'Manager' || s.role === 'Admin').length, max: 5, bg: "bg-purple-500", grad: "from-purple-500" },
                  ].map((tier) => (
                    <div key={tier.label} className="space-y-3">
                      <div className="flex justify-between items-end">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{tier.label}</span>
                        <span className="text-[10px] font-black text-foreground">{tier.val} <span className="opacity-40">/ {tier.max}</span></span>
                      </div>
                      <div className="h-2.5 w-full bg-muted/40 rounded-full overflow-hidden flex">
                        <motion.div
                          className={cn("h-full rounded-full bg-gradient-to-r to-transparent", tier.grad)}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min((tier.val / tier.max) * 100, 100)}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Attendance Logs */}
        <TabsContent value="attendance" className="focus-visible:outline-none">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            <div className="xl:col-span-8 space-y-6">
              {/* Day selection strip */}
              <div className="bg-card/40 backdrop-blur-2xl border border-border/30 rounded-[2rem] p-6 space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Select Log Day</p>
                <div className="flex items-center gap-3 overflow-x-auto pb-2 hide-scrollbar -mx-2 px-2">
                  {days.map((d) => {
                    const isSelected = d.toDateString() === selectedDay.toDateString();
                    return (
                      <button
                        key={d.toISOString()}
                        onClick={() => setSelectedDay(d)}
                        className={cn(
                          "flex flex-col items-center justify-center min-w-[64px] h-16 rounded-2xl border transition-all shrink-0",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30"
                            : "bg-background/80 text-muted-foreground border-border/40 hover:border-primary/50 hover:bg-card"
                        )}
                      >
                        <span className="text-base font-black">{d.getDate()}</span>
                        <span className="text-[8px] font-black uppercase tracking-widest mt-0.5">
                          {d.toLocaleDateString('en-US', { weekday: 'short' })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Attendance list summary */}
              <Card className="rounded-[2.5rem] border-transparent shadow-2xl bg-card/60 backdrop-blur-3xl overflow-hidden ring-1 ring-border/50">
                <div className="p-6 sm:p-8 border-b border-border/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tight text-foreground flex items-center gap-2">
                      Attendance 
                      <span className="text-muted-foreground font-medium text-sm normal-case tracking-normal">
                        ({selectedDay.toLocaleDateString('en-US', { day: 'numeric', month: 'short', weekday: 'long' })})
                      </span>
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      className="h-10 px-3 rounded-xl bg-background/50 border border-border/40 font-bold text-[10px] uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      value={attendanceStaffFilter}
                      onChange={(e) => setAttendanceStaffFilter(e.target.value)}
                    >
                      <option value="all">All Staff</option>
                      {staff.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>

                    <Button onClick={exportAttendanceCSV} variant="outline" className="h-10 rounded-xl font-black text-[10px] uppercase tracking-widest gap-2">
                      <Download className="w-3.5 h-3.5" /> Export
                    </Button>

                    <div className="flex gap-2 ml-auto">
                      <div className="text-center bg-muted/40 px-3 py-1.5 rounded-xl border border-border/30">
                        <p className="text-[9px] font-black text-muted-foreground uppercase">Check-ins</p>
                        <p className="text-sm font-black text-foreground">{filteredAttendanceRecords.length}</p>
                      </div>
                      <div className="text-center bg-muted/40 px-3 py-1.5 rounded-xl border border-border/30">
                        <p className="text-[9px] font-black text-muted-foreground uppercase">Hours</p>
                        <p className="text-sm font-black text-foreground">
                          {filteredAttendanceRecords.reduce((acc, r) => acc + getDurationHours(r), 0).toFixed(1)}h
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 sm:p-6 space-y-4">
                  {filteredAttendanceRecords.length === 0 ? (
                    <div className="py-16 text-center flex flex-col items-center justify-center">
                      <Clock className="w-12 h-12 mb-3 text-muted-foreground/50" />
                      <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">No Clock-ins found</p>
                      <p className="text-xs text-muted-foreground/60 mt-1 font-semibold">Try adjusting your filters or checking a different day.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredAttendanceRecords.map((record) => {
                        const Config = roleConfig[record.role] || roleConfig.Kitchen;
                        const on = record.clockOut === null;
                        const hrs = getDurationHours(record);
                        
                        // Calculate late arrival
                        const staffMember = staff.find(s => s.id === record.staffId);
                        let isLate = false;
                        if (staffMember && record.clockIn) {
                          const time = record.clockIn.toDate ? record.clockIn.toDate() : new Date(record.clockIn);
                          const hour = time.getHours();
                          if (staffMember.shift === "Day Shift" && hour >= 10) isLate = true;
                          if (staffMember.shift === "Night Shift" && hour >= 20) isLate = true; // 8 PM
                        }

                        return (
                          <div 
                            key={record.id}
                            className="p-4 rounded-2xl bg-card border border-border/30 hover:border-primary/20 transition-all flex items-center justify-between shadow-sm relative overflow-hidden"
                          >
                            {isLate && (
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                            )}
                            <div className="flex items-center gap-4">
                              <div className={cn("relative w-11 h-11 rounded-xl flex items-center justify-center font-black text-lg shadow-inner bg-gradient-to-br from-background to-muted border", Config.color)}>
                                <div className="absolute inset-0 rounded-xl bg-current opacity-10" />
                                {record.staffName[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-black text-foreground text-sm uppercase tracking-wide">{record.staffName}</p>
                                  {isLate && <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20">Late</span>}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  In: {formatTime(record.clockIn)} {record.clockOut ? `· Out: ${formatTime(record.clockOut)}` : ''}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className={cn("px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border", Config.color)}>
                                {record.role}
                              </div>
                              <div className={cn(
                                "px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider border shadow-sm",
                                on 
                                  ? "bg-green-500/10 text-green-500 border-green-500/20" 
                                  : "bg-muted/80 text-muted-foreground border-border/40"
                              )}>
                                {on ? "On Duty" : `${hrs.toFixed(1)} hrs`}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            </div>
            
            {/* Today Summary */}
            <div className="xl:col-span-4 space-y-6">
              <Card className="rounded-[2rem] p-6 border border-border/40 bg-card/60 backdrop-blur-2xl">
                <h4 className="text-base font-black uppercase tracking-wide text-foreground mb-4">Clocked In Team</h4>
                <div className="space-y-4">
                  {activeAttendance.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic font-semibold">No staff currently clocked in.</p>
                  ) : (
                    activeAttendance.map(a => {
                      const clockInDate = a.clockIn?.toDate ? a.clockIn.toDate() : new Date(a.clockIn);
                      const elapsed = Math.round((Date.now() - clockInDate.getTime()) / (1000 * 60));
                      const hrs = Math.floor(elapsed / 60);
                      const mins = elapsed % 60;
                      return (
                        <div key={a.id} className="flex items-center justify-between p-3 rounded-xl bg-background/50 border border-border/30">
                          <div className="flex items-center gap-3">
                            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse shadow-md" />
                            <p className="text-sm font-black text-foreground uppercase tracking-wide">{a.staffName}</p>
                          </div>
                          <p className="text-xs font-bold text-muted-foreground">{hrs}h {mins}m on-duty</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Tab 3: Payroll & Salaries */}
        <TabsContent value="payroll" className="focus-visible:outline-none">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            <div className="xl:col-span-8 space-y-6">
              {/* Period selection inputs */}
              <div className="bg-card/40 backdrop-blur-2xl border border-border/30 rounded-[2rem] p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div>
                    <h4 className="text-base font-black uppercase text-foreground">Select Payout Period</h4>
                    <p className="text-xs text-muted-foreground font-semibold mt-0.5">Define ranges to calculate employee dues</p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                    <div className="space-y-1 w-full sm:w-40">
                      <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-widest ml-1">From</Label>
                      <Input 
                        type="date" 
                        value={periodStart} 
                        onChange={(e) => setPeriodStart(e.target.value)} 
                        className="bg-background border-border/40 rounded-xl h-11 font-bold text-xs" 
                      />
                    </div>
                    <div className="space-y-1 w-full sm:w-40">
                      <Label className="text-[9px] font-black uppercase text-muted-foreground tracking-widest ml-1">To</Label>
                      <Input 
                        type="date" 
                        value={periodEnd} 
                        onChange={(e) => setPeriodEnd(e.target.value)} 
                        className="bg-background border-border/40 rounded-xl h-11 font-bold text-xs" 
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/20">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mr-2">Presets:</span>
                  <Button variant="outline" size="sm" onClick={() => setPayrollPreset('this-week')} className="h-8 rounded-lg text-xs font-bold">This Week</Button>
                  <Button variant="outline" size="sm" onClick={() => setPayrollPreset('this-month')} className="h-8 rounded-lg text-xs font-bold">This Month</Button>
                  <Button variant="outline" size="sm" onClick={() => setPayrollPreset('last-month')} className="h-8 rounded-lg text-xs font-bold">Last Month</Button>
                </div>
              </div>

              {/* Payroll list table */}
              <Card className="rounded-[2.5rem] border-transparent shadow-2xl bg-card/60 backdrop-blur-3xl overflow-hidden ring-1 ring-border/50">
                <div className="p-6 border-b border-border/10 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black uppercase tracking-tight text-foreground">Salaries Due Summary</h3>
                    <p className="text-xs text-muted-foreground font-semibold mt-0.5">Calculated based on hourly rates and attendance clockings</p>
                  </div>
                  <Button onClick={exportPayrollCSV} variant="outline" className="h-10 rounded-xl font-black text-[10px] uppercase tracking-widest gap-2">
                    <Download className="w-3.5 h-3.5" /> Export
                  </Button>
                </div>
                
                <div className="p-0 overflow-x-auto">
                  <table className="w-full text-left min-w-[600px]">
                    <thead>
                       <tr className="border-b border-border/10 bg-muted/20">
                          <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Staff Name</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Hours Worked</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Hourly Rate</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Dues (₹)</th>
                          <th className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 text-right">Actions</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-border/5">
                      {staff.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-8 py-12 text-center text-muted-foreground">
                            <Banknote className="w-8 h-8 mx-auto mb-3 opacity-20" />
                            <p className="font-bold">No staff registered to pay</p>
                          </td>
                        </tr>
                      ) : (
                        staff.map((member) => {
                          const hours = hoursByStaff[member.id] || 0;
                          const rate = member.hourlyRate || 0;
                          const due = hours * rate;

                          return (
                            <tr key={member.id} className="hover:bg-muted/30 transition-colors">
                              <td className="px-8 py-4 font-bold text-foreground">
                                <p className="text-sm font-black uppercase tracking-wide">{member.name}</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase">{member.role}</p>
                              </td>
                              <td className="px-6 py-4 text-sm font-bold text-foreground">{hours.toFixed(1)} hrs</td>
                              <td className="px-6 py-4 text-sm font-bold text-foreground">₹{rate}/hr</td>
                              <td className="px-6 py-4 text-sm font-black text-foreground">
                                <span className={cn(due > 0 ? "text-purple-500" : "text-muted-foreground")}>
                                  ₹{due.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                              </td>
                              <td className="px-8 py-4 text-right">
                                <Button
                                  disabled={due <= 0}
                                  onClick={() => {
                                    setSelectedPayrollStaff(member);
                                    setPayoutDraft({
                                      hoursWorked: Number(hours.toFixed(2)),
                                      hourlyRate: rate,
                                      bonus: 0,
                                      deduction: 0,
                                      paymentMode: "Bank Transfer",
                                      notes: ""
                                    });
                                    setPayoutDialogOpen(true);
                                  }}
                                  className="h-9 px-4 rounded-xl font-black text-[10px] uppercase tracking-widest bg-purple-500 hover:bg-purple-600 text-white shadow-md shadow-purple-500/20"
                                >
                                  Pay
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    {staff.length > 0 && (
                      <tfoot className="bg-muted/10 border-t-2 border-border/20">
                        <tr>
                          <td colSpan={3} className="px-8 py-4 text-right font-black uppercase tracking-widest text-xs text-muted-foreground">
                            Total Due Summary:
                          </td>
                          <td colSpan={2} className="px-6 py-4">
                            <span className="text-xl font-black text-foreground">
                              ₹{totalDues.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </Card>
            </div>

            {/* Recent Payouts History */}
            <div className="xl:col-span-4 space-y-6">
              <Card className="rounded-[2.5rem] border border-border/40 shadow-xl bg-card/60 backdrop-blur-2xl overflow-hidden p-6 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-black tracking-tight text-foreground uppercase italic">Recent <span className="text-primary not-italic">Payouts</span></h3>
                    <p className="text-[9px] font-bold uppercase tracking-widest opacity-50 italic mt-1.5">Salary payment logs</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                     <History className="w-4 h-4 text-purple-500" />
                  </div>
                </div>

                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                  {recentPayroll.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic font-semibold text-center py-6">No payout transactions found.</p>
                  ) : (
                    recentPayroll.map(entry => (
                      <div key={entry.id} className="p-4 rounded-2xl bg-card border border-border/30 hover:border-purple-500/20 transition-all flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-4 h-4 text-purple-500 shrink-0" />
                          <div>
                            <p className="text-xs font-black text-foreground uppercase tracking-wide">{entry.staffName}</p>
                            <p className="text-[9px] text-muted-foreground font-bold uppercase mt-0.5">
                              {entry.hoursWorked.toFixed(1)}h · {formatDate(entry.paidAt)} · {entry.paymentMode}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-black text-purple-500 shrink-0">₹{entry.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Payout dialog modal */}
      <Dialog open={payoutDialogOpen} onOpenChange={setPayoutDialogOpen}>
        <DialogContent className="rounded-2xl max-w-md border-border/40 shadow-xl bg-card p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-xl font-black uppercase italic">Pay {selectedPayrollStaff?.name}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Confirm working metrics and add adjustments. Automatically creates Salary expense.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-5">
            {/* Payout Display */}
            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-purple-500">Net Salary Payout</p>
              <h2 className="text-3xl font-black text-foreground tracking-tight mt-1">
                ₹{Math.max(0, payoutDraft.hoursWorked * payoutDraft.hourlyRate + payoutDraft.bonus - payoutDraft.deduction).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Hours Worked</Label>
                <Input 
                  type="number" 
                  value={payoutDraft.hoursWorked || ''} 
                  onChange={(e) => setPayoutDraft(d => ({ ...d, hoursWorked: Number(e.target.value) }))}
                  className="rounded-xl h-11 font-bold text-sm bg-muted/30 border-none px-4" 
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Hourly Rate (₹)</Label>
                <Input 
                  type="number" 
                  value={payoutDraft.hourlyRate || ''} 
                  onChange={(e) => setPayoutDraft(d => ({ ...d, hourlyRate: Number(e.target.value) }))}
                  className="rounded-xl h-11 font-bold text-sm bg-muted/30 border-none px-4" 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Bonus (₹)</Label>
                <Input 
                  type="number" 
                  value={payoutDraft.bonus || ''} 
                  onChange={(e) => setPayoutDraft(d => ({ ...d, bonus: Number(e.target.value) }))}
                  className="rounded-xl h-11 font-bold text-sm bg-muted/30 border-none px-4" 
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Deductions (₹)</Label>
                <Input 
                  type="number" 
                  value={payoutDraft.deduction || ''} 
                  onChange={(e) => setPayoutDraft(d => ({ ...d, deduction: Number(e.target.value) }))}
                  className="rounded-xl h-11 font-bold text-sm bg-muted/30 border-none px-4" 
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Payment Mode</Label>
              <select
                className="w-full h-11 px-3 rounded-xl bg-muted/30 border-none font-bold text-[11px] uppercase tracking-wider focus:outline-none focus:ring-1 focus:ring-primary"
                value={payoutDraft.paymentMode}
                onChange={(e) => setPayoutDraft(d => ({ ...d, paymentMode: e.target.value }))}
              >
                <option>Bank Transfer</option>
                <option>Cash</option>
                <option>UPI</option>
                <option>Card</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground opacity-60">Notes</Label>
              <Textarea 
                value={payoutDraft.notes} 
                onChange={(e) => setPayoutDraft(d => ({ ...d, notes: e.target.value }))}
                placeholder="Optional description/notes"
                className="rounded-xl bg-muted/30 border-none text-sm min-h-[60px]" 
              />
            </div>

            <Button 
              onClick={handleRunPayroll} 
              disabled={saving} 
              className="w-full h-12 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-black uppercase tracking-widest text-[11px] shadow-lg shadow-purple-500/25 mt-4"
            >
              {saving ? "Processing..." : "Confirm Salary Payout"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Staff details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-[700px] p-0 rounded-[2.5rem] overflow-hidden border border-border/40 bg-card shadow-2xl">
          <div className="flex flex-col md:flex-row h-full max-h-[85vh]">
             {/* Left Profile Sidebar */}
             <div className="w-full md:w-1/3 bg-muted/30 p-8 border-b md:border-b-0 md:border-r border-border/20 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center font-black text-4xl text-primary shadow-inner">
                   {selectedStaff?.avatar}
                </div>
                <div>
                   <h2 className="text-xl font-black uppercase italic tracking-tight">{selectedStaff?.name}</h2>
                   <div className="mt-2 inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest">
                      {selectedStaff?.role}
                   </div>
                </div>
                <div className="pt-4 w-full space-y-3">
                   <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-background border border-border/40">
                      <span className="text-muted-foreground font-semibold">Status</span>
                      <span className={cn("font-black", selectedStaff?.status === 'Active' ? 'text-green-500' : 'text-amber-500')}>{selectedStaff?.status}</span>
                   </div>
                   <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-background border border-border/40">
                      <span className="text-muted-foreground font-semibold">Score</span>
                      <span className="font-black flex items-center gap-1"><Zap className="w-3 h-3 text-amber-500"/> {selectedStaff?.performance}</span>
                   </div>
                </div>
             </div>

             {/* Right Edit Form */}
             <div className="w-full md:w-2/3 p-8 overflow-y-auto">
               <DialogHeader className="mb-6 text-left">
                 <DialogTitle className="text-2xl font-black">Edit Details</DialogTitle>
                 <DialogDescription className="text-xs">Update staff information and preferences.</DialogDescription>
               </DialogHeader>

               <div className="space-y-5">
                 <div className="grid sm:grid-cols-2 gap-4">
                   <div className="space-y-1.5">
                     <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">Full Name</Label>
                     <Input className="h-11 rounded-xl bg-muted/20" value={editDraft.name} onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))} />
                   </div>
                   <div className="space-y-1.5">
                     <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">Status</Label>
                     <select
                       className="w-full h-11 rounded-xl bg-muted/20 border-border/40 px-3 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary"
                       value={editDraft.status}
                       onChange={(e) => setEditDraft((p) => ({ ...p, status: e.target.value as any }))}
                     >
                       <option>Active</option>
                       <option>Off-Duty</option>
                       <option>On Leave</option>
                       <option>Inactive</option>
                     </select>
                   </div>
                 </div>

                 <div className="grid sm:grid-cols-2 gap-4">
                   <div className="space-y-1.5">
                     <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">Role</Label>
                     <select
                       className="w-full h-11 rounded-xl bg-muted/20 border-border/40 px-3 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary"
                       value={editDraft.role}
                       onChange={(e) => setEditDraft((p) => ({ ...p, role: e.target.value }))}
                     >
                       {["Manager", "Kitchen", "Cashier", "Admin", "Waiter"].map((r) => (
                         <option key={r} value={r}>{r}</option>
                       ))}
                     </select>
                   </div>
                   <div className="space-y-1.5">
                     <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">Shift</Label>
                     <select
                       className="w-full h-11 rounded-xl bg-muted/20 border-border/40 px-3 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary"
                       value={editDraft.shift}
                       onChange={(e) => setEditDraft((p) => ({ ...p, shift: e.target.value }))}
                     >
                       <option>Day Shift</option>
                       <option>Night Shift</option>
                       <option>Full Time</option>
                     </select>
                   </div>
                 </div>

                 <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 [&_.PhoneInputInput]:h-11 [&_.PhoneInputInput]:rounded-xl [&_.PhoneInputInput]:bg-muted/20 [&_.PhoneInputInput]:border [&_.PhoneInputInput]:border-input [&_.PhoneInputInput]:px-3 [&_.PhoneInputInput]:text-sm [&_.PhoneInputInput]:focus-visible:outline-none [&_.PhoneInputInput]:focus-visible:ring-1 [&_.PhoneInputInput]:focus-visible:ring-primary">
                      <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">Phone</Label>
                      <PhoneInput
                        maxLength={15}
                        international
                        defaultCountry="IN"
                        value={editDraft.phone}
                        onChange={(val) => setEditDraft((p) => ({ ...p, phone: val || "" }))}
                        className="w-full font-bold"
                      />
                     {editDraft.phone && (
                       <a className="text-[10px] font-bold text-primary inline-flex items-center gap-1.5 mt-1" href={`tel:${editDraft.phone}`}>
                         <Phone className="w-3 h-3" /> Call
                       </a>
                     )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">Hourly Rate (₹)</Label>
                      <Input 
                        type="number" 
                        className="h-11 rounded-xl bg-muted/20" 
                        value={editDraft.hourlyRate || ''} 
                        onChange={(e) => setEditDraft((p) => ({ ...p, hourlyRate: Number(e.target.value) }))} 
                      />
                    </div>
                 </div>

                 <div className="grid sm:grid-cols-2 gap-4">
                   <div className="space-y-1.5">
                     <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">Email</Label>
                     <Input className="h-11 rounded-xl bg-muted/20" value={editDraft.email} onChange={(e) => setEditDraft((p) => ({ ...p, email: e.target.value }))} />
                     {editDraft.email && (
                       <a className="text-[10px] font-bold text-primary inline-flex items-center gap-1.5 mt-1" href={`mailto:${editDraft.email}`}>
                         <Mail className="w-3 h-3" /> Email
                       </a>
                     )}
                   </div>
                   <div className="space-y-1.5">
                     <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">PIN (4-digits)</Label>
                     <div className="relative">
                       <Input className="h-11 rounded-xl bg-muted/20 pr-10" maxLength={4} type={showPin ? "text" : "password"} value={editDraft.pin} onChange={(e) => setEditDraft((p) => ({ ...p, pin: e.target.value }))} />
                       <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                         {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                       </button>
                     </div>
                   </div>
                 </div>

                 <div className="space-y-1.5">
                   <Label className="text-[9px] font-black uppercase tracking-widest opacity-60">Notes</Label>
                   <Textarea
                     className="rounded-xl min-h-[90px] bg-muted/20 border-border/40 focus:ring-primary focus:border-primary"
                     value={editDraft.notes}
                     onChange={(e) => setEditDraft((p) => ({ ...p, notes: e.target.value }))}
                     placeholder="Skills, responsibilities, preferred station, etc."
                   />
                 </div>
               </div>

               <DialogFooter className="mt-8 gap-3 sm:gap-0">
                 <Button variant="ghost" className="rounded-xl font-bold uppercase tracking-wider text-xs" onClick={() => setDetailsOpen(false)}>Cancel</Button>
                 <Button className="rounded-xl px-8 font-black uppercase tracking-wider text-xs" disabled={saving} onClick={saveStaffDetails}>{saving ? "Saving..." : "Save Changes"}</Button>
               </DialogFooter>
             </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
