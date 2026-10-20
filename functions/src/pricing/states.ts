/**
 * Indian GST state codes. Place of supply and CGST/SGST vs IGST depend on
 * them, and addresses in the apps store state NAMES, so this resolves a name,
 * a two-digit code or a GSTIN to the code.
 */

export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const squash = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

const BY_NAME: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [code, name] of Object.entries(GST_STATE_CODES)) m.set(squash(name), code);
  const aliases: Record<string, string> = {
    jk: "01", jammukashmir: "01",
    newdelhi: "07", nctofdelhi: "07", nationalcapitalterritoryofdelhi: "07",
    orissa: "21", pondicherry: "34", uttaranchal: "05",
    daman: "26", diu: "26", damananddiu: "26", dadranagarhaveli: "26", dadraandnagarhaveli: "26",
    andaman: "35", andamannicobar: "35", tamilnad: "33", ap: "37", tn: "33", ka: "29", kl: "32", mh: "27",
  };
  for (const [alias, code] of Object.entries(aliases)) m.set(alias, code);
  return m;
})();

/** A two-digit GST state code from a code, GSTIN or state name; "" when unknown. */
export function stateCodeOf(value: unknown): string {
  const raw = (value ?? "").toString().trim();
  if (!raw) return "";
  const lead = /^(\d{1,2})(?!\d{3,})/.exec(raw);
  if (lead) {
    const code = lead[1].padStart(2, "0");
    if (GST_STATE_CODES[code]) return code;
  }
  return BY_NAME.get(squash(raw)) ?? "";
}
