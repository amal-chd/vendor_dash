import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, setDoc, doc } from "firebase/firestore";

/**
 * Utility class for exporting data and common backend actions
 */
export class ExportHelper {
  /**
   * Generates a CSV from an array of objects and triggers a download
   */
  static downloadCSV(data: Record<string, unknown>[], filename: string) {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map(row => headers.map(header => {
        const value = row[header] ?? "";
        return typeof value === "string" ? `"${value.replace(/"/g, '""')}"` : value;
      }).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Triggers a browser print for a specific element or the whole page
   */
  static printElement(elementId?: string) {
    if (elementId) {
      const printContents = document.getElementById(elementId)?.innerHTML;
      if (printContents) {
        const originalContents = document.body.innerHTML;
        document.body.innerHTML = printContents;
        window.print();
        document.body.innerHTML = originalContents;
        window.location.reload(); // Reload to restore React state/bindings
        return;
      }
    }
    window.print();
  }
}

/**
 * Utility class for Marketing & CRM actions
 */
export class MarketingHelper {
  /**
   * Saves a new campaign or automation sequence to Firestore
   */
  static async saveCampaign(restaurantId: string, campaignData: Record<string, unknown>) {
    try {
      const campaignRef = collection(db, "campaigns");
      const docRef = await addDoc(campaignRef, {
        ...campaignData,
        restaurantId,
        createdAt: serverTimestamp(),
        status: "Running"
      });
      return docRef.id;
    } catch (error) {
      console.error("Error saving campaign:", error);
      throw error;
    }
  }
}
