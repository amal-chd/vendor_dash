import { useMemo, useState, useEffect, useCallback } from "react";
import { Plus, Minus, CreditCard, Banknote, Smartphone, ReceiptText, SplitSquareVertical, Loader2, ShoppingCart, ArrowRight, Utensils, Clock } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { motion } from "framer-motion";
import { cn, getTaxLabel } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { PageLoading } from "@/components/dashboard/PageLoading";
import { Button } from "@/components/ui/button";
import { addDoc, collection, serverTimestamp, query, where, onSnapshot, doc, getDoc, limit } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { FeatureGate } from "@/components/FeatureGate";
import { nextOrderNumber } from "@/lib/orderNumber";
type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: string;
  image?: string;
  imageUrl?: string;
  tag: string;
};

type CartItem = { name: string; price: number; qty: number };

export default function POSPage() {
  const { user, activeRestaurantId, billingAccountId } = useAuth();
  const { format, locale, symbol } = useCurrency();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedTable, setSelectedTable] = useState<{ id: string; name: string } | null>(null);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restaurant, setRestaurant] = useState<{
    name?: string;
    address?: string;
    phone?: string;
    logoUrl?: string;
    enableTax?: boolean;
    /** Configurable tax rate (percent). Defaults to 5 if unset. */
    taxPercentage?: number;
    taxId?: string;
    taxLabel?: string;
    taxMethod?: 'inclusive' | 'exclusive' | string;
    countryCode?: string;
    gstin?: string;
    fssaiLicense?: string;
    upiId?: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"tables" | "menu" | "bill">("menu");
  const [showUpiModal, setShowUpiModal] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Fetch Restaurant Details — outlets read the parent restaurant doc so
    // tax flag, address, branding, etc. all match the parent.
    const fetchRestaurantArr = async () => {
      try {
        const docRef = doc(db, "restaurants", activeRestaurantId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) setRestaurant(docSnap.data());
      } catch (err) {
        console.error(err);
      }
    };
    fetchRestaurantArr();

    // Fetch Menu — capped at 500 items; beyond that operators should use categories
    const effectiveMenuId = activeRestaurantId;
    const menuQuery = query(
      collection(db, "menu"),
      where("restaurantId", "==", effectiveMenuId),
      limit(500),
    );
    const unsubscribeMenu = onSnapshot(menuQuery, (snapshot) => {
      const menuData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MenuItem));
      setMenuItems(menuData);
      setLoading(false);
    }, (err) => console.error("[POSPage] menuQuery listener failed", err));

    // Fetch Tables — restaurants rarely have more than 100 tables
    const tablesQuery = query(
      collection(db, "tables"),
      where("restaurantId", "==", activeRestaurantId),
      limit(100),
    );
    const unsubscribeTables = onSnapshot(tablesQuery, (snapshot) => {
      const tablesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Array<{ id: string; name: string; status: string }>;
      setTables(tablesData);
      if (tablesData.length > 0 && !selectedTable) {
        setSelectedTable(tablesData[0]);
      }
    }, (err) => console.error("[POSPage] tablesQuery listener failed", err));

    return () => {
      unsubscribeMenu();
      unsubscribeTables();
    };
  }, [user, activeRestaurantId]);

  const categories = useMemo(() => ["All", ...Array.from(new Set(menuItems.map(i => i.category)))], [menuItems]);

  const filteredItems = useMemo(
    () => activeCategory === "All" ? menuItems : menuItems.filter(i => i.category === activeCategory),
    [menuItems, activeCategory],
  );

  const addToCart = useCallback((name: string, price: number) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.name === name);
      if (existing) return prev.map((item) => (item.name === name ? { ...item, qty: item.qty + 1 } : item));
      return [...prev, { name, price, qty: 1 }];
    });
  }, []);

  const updateQty = useCallback((name: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => (item.name === name ? { ...item, qty: Math.max(0, item.qty + delta) } : item)).filter((item) => item.qty > 0)
    );
  }, []);

  const { subtotal, tax, cgst, sgst, discount, total, taxPct } = useMemo(() => {
    const rawSubtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const rawPct = restaurant?.taxPercentage;
    const taxPct = typeof rawPct === "number" && Number.isFinite(rawPct) && rawPct >= 0
      ? rawPct
      : 5;

    let sub = 0;
    let taxV = 0;
    let discV = 0;
    let totalV = 0;

    if (restaurant?.taxMethod === "inclusive") {
      discV = discountType === "percent" ? rawSubtotal * (discountValue / 100) : discountValue;
      totalV = Math.max(0, rawSubtotal - discV);
      if (restaurant?.enableTax) {
        sub = totalV / (1 + taxPct / 100);
        taxV = totalV - sub;
      } else {
        sub = totalV;
        taxV = 0;
      }
    } else {
      // exclusive
      sub = rawSubtotal;
      taxV = restaurant?.enableTax ? sub * (taxPct / 100) : 0;
      discV = discountType === "percent" ? sub * (discountValue / 100) : discountValue;
      totalV = Math.max(0, sub + taxV - discV);
    }
    const cgst = taxV / 2;
    const sgst = taxV / 2;
    return { subtotal: sub, tax: taxV, cgst, sgst, discount: discV, total: totalV, taxPct };
  }, [cart, discountType, discountValue, restaurant?.enableTax, restaurant?.taxPercentage, restaurant?.taxMethod]);

  const handleSendKOT = async () => {
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    setProcessing(true);
    try {
      const orderNumber = await nextOrderNumber(activeRestaurantId, "KD");
      await addDoc(collection(db, "orders"), {
        // For outlet sub-accounts, write under the parent restaurant so the
        // parent dashboard / mobile shell sees orders too.
        restaurantId: activeRestaurantId,
        restaurantName: restaurant?.name || "Restaurant",
        zoneId: (restaurant as any)?.zoneId || null,
        zoneName: (restaurant as any)?.zoneName || null,
        marketId: (restaurant as any)?.marketId || null,
        parentId: billingAccountId,
        // In-store walk-in ticket. Untagged orders were classified as online
        // marketplace orders by finance and by the order rules.
        orderSource: "pos",
        orderNumber,
        table: selectedTable?.name || "Takeaway",
        items: cart,
        subtotal,
        tax,
        cgst,
        sgst,
        discount,
        total,
        status: "new",
        type: selectedTable?.name === "Takeaway" ? "takeaway" : "dine-in",
        timestamp: serverTimestamp(),
      });
      toast.success("KOT sent to kitchen!");
      setCart([]);
    } catch (error) {
      console.error(error);
      toast.error("Failed to send KOT");
    } finally {
      setProcessing(false);
    }
  };

  const printBill = (orderNumber?: string) => {
    const num = orderNumber ?? `KD-${Date.now().toString().slice(-5)}`;
    const printWindow = window.open('', '', 'width=450,height=800');
    if (!printWindow) return;

    const shopName = restaurant?.name || "KADA RESTAURANT";
    const shopAddress = restaurant?.address || "Premium Dining Experience";
    const shopPhone = restaurant?.phone || "+91 XXXXXXXXXX";
    const shopLogo = restaurant?.logoUrl || "/logo.png";
    const taxId = restaurant?.taxId || "";
    const taxLabel = restaurant?.taxLabel || getTaxLabel(restaurant?.countryCode);
    const isInclusive = restaurant?.taxMethod === "inclusive";

    const itemsHtml = cart.map((item) => `
      <tr class="item-row">
        <td class="qty-col">
          <div class="qty-capsule">${item.qty}</div>
        </td>
        <td class="desc">
          <div class="name">${item.name}</div>
          <div class="unit-price">@${symbol}${item.price.toLocaleString()} ${restaurant?.countryCode === "IN" ? '· SAC 996331' : ''}</div>
        </td>
        <td class="price">${symbol}${(item.price * item.qty).toLocaleString()}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt #${num}</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Inter', sans-serif; 
            background: #fff; 
            color: #1a1a1a; 
            padding: 30px; 
            max-width: 400px; 
            margin: auto;
            line-height: 1.4;
          }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { 
            width: 70px; 
            height: 70px; 
            object-fit: cover; 
            border-radius: 100%; 
            margin-bottom: 15px;
            border: 2px solid #f0f0f0;
          }
          .brand-name { 
            font-family: 'Outfit', sans-serif; 
            font-size: 26px; 
            font-weight: 900; 
            letter-spacing: -0.5px; 
            text-transform: uppercase;
            margin-bottom: 4px;
            color: #000;
          }
          .brand-tagline { 
            font-size: 9px; 
            font-weight: 800; 
            color: #999; 
            text-transform: uppercase; 
            letter-spacing: 3px;
          }
          
          .shop-details { margin: 20px 0; font-size: 11px; color: #555; font-weight: 600; }
          .shop-details p { margin-bottom: 3px; }
          
          .bill-info { 
            display: flex; 
            justify-content: space-between; 
            padding: 15px 0; 
            border-top: 1.5px solid #000; 
            border-bottom: 1.5px solid #f0f0f0;
            margin-bottom: 25px;
          }
          .info-block h4 { font-size: 8px; font-weight: 900; color: #bbb; text-transform: uppercase; margin-bottom: 4px; }
          .info-block p { font-size: 12px; font-weight: 800; color: #000; }
          
          table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
          th { text-align: left; font-size: 9px; font-weight: 900; color: #aaa; text-transform: uppercase; padding-bottom: 12px; border-bottom: 2px solid #000; }
          .item-row td { padding: 15px 0; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
          .qty-col { width: 50px; }
          .qty-capsule { 
            display: inline-flex; 
            align-items: center; 
            justify-content: center; 
            background: #000; 
            color: #fff; 
            font-size: 11px; 
            font-weight: 900; 
            padding: 4px 10px; 
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          }
          .name { font-weight: 800; font-size: 14px; text-transform: uppercase; margin-bottom: 4px; letter-spacing: -0.2px; }
          .unit-price { font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; }
          .price { text-align: right; font-weight: 900; font-size: 15px; color: #000; font-family: 'Outfit', sans-serif; }
          
          .summary { margin-top: 10px; }
          .summary-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #444; font-weight: 600; }
          .summary-row.total { 
            margin-top: 15px; 
            padding: 15px 0; 
            border-top: 2.5px solid #000; 
            border-bottom: 1px solid #000;
            color: #000; 
            font-size: 22px; 
            font-weight: 900; 
            font-family: 'Outfit', sans-serif;
          }
          .tax-id { font-size: 9px; color: #999; font-weight: 700; margin-top: 8px; }
          
          .footer { text-align: center; margin-top: 50px; padding-top: 30px; border-top: 1px dashed #ddd; }
          .thanks { font-family: 'Outfit', sans-serif; font-weight: 900; font-size: 18px; margin-bottom: 6px; text-transform: uppercase; }
          .visit-again { font-size: 10px; color: #999; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 20px; }
          
          .powered { font-size: 8px; color: #ddd; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; }
          
          @media print {
            body { padding: 15px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="${shopLogo}" class="logo" onerror="this.style.display='none'">
          <h1 class="brand-name">${shopName}</h1>
          <p class="brand-tagline">Excellence in Hospitality</p>
          
          <div class="shop-details">
            <p>${shopAddress}</p>
            <p>Phone: ${shopPhone}</p>
            ${(restaurant?.gstin || taxId) ? `<p class="tax-id">GSTIN: ${restaurant?.gstin || taxId}</p>` : ''}
            ${restaurant?.fssaiLicense ? `<p class="tax-id">FSSAI Lic No: ${restaurant.fssaiLicense}</p>` : ''}
          </div>
        </div>
        
        <div class="bill-info">
          <div class="info-block">
            <h4>Order Number</h4>
            <p>#${num}</p>
          </div>
          <div class="info-block">
            <h4>Table/Mode</h4>
            <p>${selectedTable?.name || 'Takeaway'}</p>
          </div>
          <div class="info-block" style="text-align: right;">
            <h4>Date</h4>
            <p>${new Date().toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Qty</th>
              <th>Item / Description</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="summary">
          <div class="summary-row">
            <span>Subtotal</span>
            <span>${symbol}${subtotal.toLocaleString(locale)}</span>
          </div>
          ${restaurant?.enableTax ? (restaurant?.countryCode === "IN" ? `
          <div class="summary-row">
            <span>CGST (${taxPct / 2}%)</span>
            <span>${symbol}${(tax / 2).toLocaleString(locale)}</span>
          </div>
          <div class="summary-row">
            <span>SGST (${taxPct / 2}%)</span>
            <span>${symbol}${(tax / 2).toLocaleString(locale)}</span>
          </div>
          ` : `
          <div class="summary-row">
            <span>${restaurant.taxLabel || 'Tax'} (${taxPct}%)</span>
            <span>${symbol}${tax.toLocaleString(locale)}</span>
          </div>
          `) : ''}
          ${discount > 0 ? `
          <div class="summary-row" style="color: #10B981;">
            <span>Discount</span>
            <span>-${symbol}${discount.toLocaleString(locale)}</span>
          </div>
          ` : ''}
          <div class="summary-row total">
            <span>Total Payable</span>
            <span>${symbol}${total.toLocaleString(locale)}</span>
          </div>
        </div>

        <div class="footer">
          <h2 class="thanks">Thank You!</h2>
          <p class="visit-again">Hope to serve you again</p>

          <div style="margin-top: 40px;">
            <p class="powered">Powered by KADA DINE</p>
            <p style="font-size: 8px; color: #ccc; margin-top: 15px; font-weight: 700;">${new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} • Generated via Cloud POS</p>
          </div>
        </div>

        <script>
          window.onload = function() { 
            setTimeout(() => {
              window.print(); 
              window.close();
            }, 600);
          }
        </script>
      </body>
      </html>
    `;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleCheckout = async (paymentMethod: string, isPending: boolean = false) => {
    if (cart.length === 0) { toast.error("Cart is empty"); return; }
    setProcessing(true);
    try {
      const orderNumber = await nextOrderNumber(activeRestaurantId, "KD");
      await addDoc(collection(db, "orders"), {
        restaurantId: activeRestaurantId,
        restaurantName: restaurant?.name || "Restaurant",
        zoneId: (restaurant as any)?.zoneId || null,
        zoneName: (restaurant as any)?.zoneName || null,
        marketId: (restaurant as any)?.marketId || null,
        parentId: billingAccountId,
        orderSource: "pos",
        orderNumber: orderNumber,
        table: selectedTable?.name || "Takeaway",
        items: cart,
        subtotal, tax, cgst, sgst, discount, total,
        paymentMethod,
        paymentStatus: isPending ? "pending" : "paid",
        status: "new",
        type: selectedTable?.name === "Takeaway" ? "takeaway" : "dine-in",
        timestamp: serverTimestamp(),
      });

      toast.success("Order placed successfully!", {
        description: `Order #${orderNumber} for ${paymentMethod}`,
        action: {
          label: "Print Bill",
          onClick: () => printBill(orderNumber)
        },
        duration: 10000,
      });

      // Also trigger the "popup" automatically as requested
      printBill(orderNumber);

      setCart([]);
    } catch (error) {
      toast.error("Checkout failed");
    } finally { setProcessing(false); }
  };

  if (loading) return <PageLoading stats={3} chart={false} rows={6} />;

  return (
    <FeatureGate capability="pos_sync">
      {/* dvh = dynamic viewport height (shrinks when browser chrome shows/hides on mobile) */}
      <div className="flex flex-col h-[calc(100dvh-140px)] lg:h-[calc(100vh-140px)] overflow-hidden -m-4 md:-m-6 lg:-m-8 relative">

        {/* Mobile Tab Bar */}
        <div className="lg:hidden flex border-b border-border bg-card shrink-0">
          {(['tables', 'menu', 'bill'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex-1 py-4 text-[10px] font-black uppercase tracking-widest transition-all relative",
                activeTab === tab ? "text-primary" : "text-muted-foreground"
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {activeTab === tab && (
                <motion.div layoutId="posTab" className="absolute bottom-0 left-0 right-0 h-1 bg-primary" />
              )}
              {tab === 'bill' && cart.length > 0 && (
                <span className="absolute top-2 right-4 bg-primary text-primary-foreground w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black animate-pulse">
                  {cart.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 3-Column POS Container */}
        <div className="flex flex-1 overflow-hidden h-full relative">

          {/* Left: Table Selection (20%) */}
          <div className={cn(
            "lg:w-1/5 border-r border-border bg-muted/20 flex flex-col absolute inset-0 lg:relative z-10 bg-background lg:bg-transparent transition-transform duration-300",
            activeTab === "tables" ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}>
            <div className="p-4 border-b border-border bg-card hidden lg:block">
              <h2 className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Select Table</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 lg:p-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-2 gap-3 lg:gap-2 content-start">
              {tables.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelectedTable(t);
                    if (window.innerWidth < 1024) setActiveTab("menu");
                  }}
                  className={cn(
                    "p-2 sm:p-3 rounded-xl sm:rounded-2xl border text-center transition-all h-20 sm:h-24 lg:h-20 flex flex-col items-center justify-center gap-1 shadow-sm",
                    selectedTable?.id === t.id ? "bg-primary text-primary-foreground border-primary shadow-lg scale-105" : "bg-card hover:bg-muted border-border"
                  )}
                >
                  <p className="text-[9px] sm:text-[10px] lg:text-xs font-black tracking-tight">{t.name}</p>
                  <div className={cn("w-1 sm:w-1.5 h-1 sm:h-1.5 rounded-full", t.status === "Available" ? "bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-warning shadow-[0_0_8px_rgba(234,179,8,0.5)]")} />
                </button>
              ))}
              <button
                onClick={() => {
                  setSelectedTable({ id: "takeaway", name: "Takeaway" });
                  if (window.innerWidth < 1024) setActiveTab("menu");
                }}
                className={cn(
                  "p-3 rounded-2xl border text-center transition-all h-24 lg:h-20 flex flex-col items-center justify-center gap-1 shadow-sm",
                  selectedTable?.id === "takeaway" ? "bg-primary text-primary-foreground border-primary shadow-lg scale-105" : "bg-card hover:bg-muted border-border"
                )}
              >
                <p className="text-[10px] lg:text-xs font-black tracking-tight">Takeaway</p>
                <ShoppingCart className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Center: Menu Items (50%) */}
          <div className={cn(
            "lg:w-3/5 flex flex-col bg-background absolute inset-0 lg:relative z-0 transition-opacity duration-300",
            activeTab === "menu" ? "opacity-100 visible" : "opacity-0 invisible lg:opacity-100 lg:visible"
          )}>
            {/* Categories Tab Bar */}
            <div className="flex items-center gap-2 p-3 border-b border-border overflow-x-auto scrollbar-none bg-card sticky top-0 z-10">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  variant={activeCategory === cat ? "default" : "secondary"}
                  onClick={() => setActiveCategory(cat)}
                  className="h-10 lg:h-12 px-5 lg:px-6 rounded-xl lg:rounded-2xl font-black shrink-0 text-[10px] lg:text-sm shadow-sm uppercase tracking-widest"
                >
                  {cat}
                </Button>
              ))}
            </div>

            {/* Items Grid — absolute-scroll pattern avoids the flex-1+grid height collapse bug */}
            <div className="relative flex-1 min-h-0">
              <div className="absolute inset-0 overflow-y-auto">
                <div className="p-3 pb-28 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredItems.map((item) => {
                    const cartItem = cart.find(c => c.name === item.name);
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          addToCart(item.name, item.price);
                          toast.success(`Added ${item.name}`, { duration: 800, position: "bottom-center" });
                        }}
                        className="bg-card rounded-2xl border border-border/50 hover:border-primary/50 hover:shadow-md shadow-sm transition-all text-left group active:scale-95 overflow-hidden flex flex-col"
                      >
                        {/* Image area — flex-none prevents flex from compressing it */}
                        <div className="flex-none h-28 w-full relative overflow-hidden bg-muted">
                          {(item.image || item.imageUrl) ? (
                            <img
                              loading="lazy"
                              src={item.image || item.imageUrl}
                              alt={item.name}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Utensils className="w-8 h-8 opacity-15" />
                            </div>
                          )}
                          {cartItem && (
                            <div className="absolute inset-0 bg-primary/20 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                              <div className="bg-primary text-primary-foreground w-11 h-11 rounded-full flex flex-col items-center justify-center shadow-xl border-4 border-background">
                                <span className="text-[9px] font-black leading-none opacity-60">QTY</span>
                                <span className="text-base font-black leading-none">{cartItem.qty}</span>
                              </div>
                            </div>
                          )}
                          {item.tag && (
                            <div className="absolute top-2 right-2">
                              <span className={cn(
                                "text-[8px] font-black px-2 py-0.5 rounded-full",
                                item.tag.toLowerCase() === "veg"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-600"
                              )}>
                                {item.tag}
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Text area */}
                        <div className="p-2.5 sm:p-3 space-y-0.5 flex-1">
                          <p className="font-bold text-[10px] sm:text-xs leading-tight group-hover:text-primary transition-colors line-clamp-2 uppercase tracking-tight">{item.name}</p>
                          <p className="font-black text-primary text-sm sm:text-base tracking-tight">{format(item.price)}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Mobile Quick Bill Bar */}
            {cart.length > 0 && activeTab === "menu" && (
              <div className="lg:hidden fixed bottom-20 left-4 right-4 bg-primary rounded-2xl p-4 shadow-2xl flex items-center justify-between animate-in slide-in-from-bottom-4 z-50">
                <div className="text-primary-foreground">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-80">{cart.length} Items</p>
                  <p className="text-lg font-black tracking-tighter">{format(total)}</p>
                </div>
                <Button onClick={() => setActiveTab("bill")} variant="secondary" className="rounded-xl font-black uppercase text-xs px-6 h-12 shadow-lg">
                  Go to Bill
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </div>

          {/* Right: Bill Summary (30%) */}
          <div className={cn(
            "lg:w-1/3 border-l border-border bg-card flex flex-col shadow-2xl z-20 transition-transform duration-300 absolute inset-0 lg:relative",
            activeTab === "bill" ? "translate-x-0" : "translate-x-full lg:translate-x-0"
          )}>
            <div className="p-4 border-b border-border flex items-center justify-between bg-card shrink-0">
              <h3 className="font-black text-[10px] lg:text-xs uppercase tracking-widest text-muted-foreground">Order for: {selectedTable?.name || '---'}</h3>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCart([])} className="text-destructive font-black text-[10px] h-8 px-2 uppercase">Clear</Button>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("menu")} className="lg:hidden text-foreground font-black text-[10px] h-8 px-2 uppercase">Menu</Button>
              </div>
            </div>

            {/* Cart Items List — absolute-scroll pattern */}
            <div className="relative flex-1 min-h-0">
            <div className="absolute inset-0 overflow-y-auto p-3 sm:p-4 space-y-2 sm:space-y-3 pb-4">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-30 gap-4">
                  <ShoppingCart className="w-10 h-10 sm:w-12 sm:h-12" />
                  <p className="font-bold uppercase tracking-widest text-[10px] sm:text-xs">Nothing added yet</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.name} className="flex flex-col gap-1.5 sm:gap-2 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-muted/30 border border-border/50 animate-in fade-in slide-in-from-right-4">
                    <div className="flex justify-between items-start">
                      <p className="font-black text-xs sm:text-sm truncate pr-2 uppercase">{item.name}</p>
                      <p className="font-black text-xs sm:text-sm whitespace-nowrap">{format(item.price * item.qty)}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQty(item.name, -1)} className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-background border flex items-center justify-center hover:bg-muted active:scale-90 transition-all"><Minus className="w-2.5 h-2.5 sm:w-3 sm:h-3" /></button>
                        <span className="w-8 sm:w-10 text-center font-black text-[10px] sm:text-xs bg-primary/10 text-primary py-0.5 rounded-md shadow-inner">{item.qty}</span>
                        <button onClick={() => updateQty(item.name, 1)} className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-background border flex items-center justify-center hover:bg-muted active:scale-90 transition-all"><Plus className="w-2.5 h-2.5 sm:w-3 sm:h-3" /></button>
                      </div>
                      <p className="text-[9px] sm:text-[10px] font-bold text-muted-foreground italic">@ {format(item.price)}</p>
                    </div>
                  </div>
                )
                ))}
            </div>
            </div>{/* end absolute-scroll wrapper */}

            {/* Totals & Payments */}
            <div className="p-4 border-t border-border bg-muted/10 space-y-4 shrink-0">
              <div className="space-y-2 text-sm font-bold">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{format(subtotal)}</span>
                </div>
                {restaurant?.enableTax && (
                  restaurant?.countryCode === "IN" ? (
                    <>
                      <div className="flex justify-between text-muted-foreground text-xs">
                        <span>CGST ({taxPct / 2}%)</span>
                        <span>{format(tax / 2)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground text-xs">
                        <span>SGST ({taxPct / 2}%)</span>
                        <span>{format(tax / 2)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-muted-foreground text-xs">
                      <span>{restaurant.taxLabel || 'Tax'} ({taxPct}%)</span>
                      <span>{format(tax)}</span>
                    </div>
                  )
                )}
                <div className="flex justify-between pt-2 border-t border-border/50 text-foreground font-black text-xl tracking-tighter">
                  <span>Total</span>
                  <span className="text-primary">{format(total)}</span>
                </div>
              </div>

              {/* Quick Payment Buttons (Petpooja style) */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleCheckout("Cash")}
                  className="flex flex-col items-center justify-center py-4 bg-success/10 text-success border border-success/20 rounded-2xl hover:bg-success hover:text-white transition-all active:scale-95 gap-1 group"
                >
                  <Banknote className="w-6 h-6 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-black uppercase">CASH</span>
                </button>
                <button
                  onClick={() => handleCheckout("Card")}
                  className="flex flex-col items-center justify-center py-4 bg-primary/10 text-primary border border-primary/20 rounded-2xl hover:bg-primary hover:text-white transition-all active:scale-95 gap-1 group"
                >
                  <CreditCard className="w-6 h-6 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-black uppercase">CARD</span>
                </button>
                <button
                  onClick={() => setShowUpiModal(true)}
                  className="flex flex-col items-center justify-center py-4 bg-orange-500/10 text-orange-500 border border-orange-500/20 rounded-2xl hover:bg-orange-500 hover:text-white transition-all active:scale-95 gap-1 group"
                >
                  <Smartphone className="w-6 h-6 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-black uppercase">UPI</span>
                </button>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => handleCheckout("Pay Later", true)}
                  className="w-full flex items-center justify-center py-4 bg-amber-500/10 text-amber-500 border-2 border-dashed border-amber-500/30 rounded-2xl hover:bg-amber-500 hover:text-white transition-all active:scale-95 gap-3 group"
                >
                  <Clock className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                  <span className="text-xs font-black uppercase tracking-widest">Pay Later (At Leaving)</span>
                </button>
              </div>

              <div className="flex gap-2 w-full">
                <Button
                  onClick={handleSendKOT}
                  disabled={processing}
                  variant="outline"
                  className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest text-[11px] gap-3 border-2 border-foreground"
                >
                  {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ReceiptText className="w-5 h-5" />}
                  KOT
                </Button>
                <Button
                  onClick={() => printBill()}
                  variant="outline"
                  className="flex-1 h-14 rounded-2xl font-black uppercase tracking-widest text-[11px] gap-3 border-2 border-primary text-primary hover:bg-primary/5"
                >
                  <ReceiptText className="w-5 h-5" />
                  Print Bill
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showUpiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl border border-border animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-black mb-1">UPI Instant Payment</h3>
            <p className="text-xs text-muted-foreground mb-4">Scan with Google Pay, PhonePe, or Paytm</p>
            <div className="bg-white p-4 rounded-2xl inline-block shadow-inner mx-auto mb-4">
              <QRCodeSVG
                value={`upi://pay?pa=${encodeURIComponent(restaurant?.upiId || (restaurant?.phone ? `${restaurant.phone}@okaxis` : "thekada@okaxis"))}&pn=${encodeURIComponent(restaurant?.name || "Kada Dine")}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Order Payment")}`}
                size={200}
                level="M"
              />
            </div>
            <div className="bg-muted/50 p-3 rounded-xl text-xs font-bold font-mono mb-6 break-all">
              {restaurant?.upiId || (restaurant?.phone ? `${restaurant.phone}@okaxis` : "thekada@okaxis")} • {format(total)}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl font-bold" onClick={() => setShowUpiModal(false)}>
                Cancel
              </Button>
              <Button className="flex-1 rounded-xl font-bold bg-success hover:bg-success/90 text-white" onClick={() => { setShowUpiModal(false); handleCheckout("UPI"); }}>
                Confirm Received
              </Button>
            </div>
          </div>
        </div>
      )}
    </FeatureGate>
  );
}
