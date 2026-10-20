import { BrandLockup, type BrandLockupProps } from "@/components/admin/core/BrandLockup";

export function CustomerBrandLockup(props: BrandLockupProps) {
  return (
    <BrandLockup
      {...props}
      logoSrc="/kada-customer-logo.png"
      logoAlt="The Kada"
      logoClassName="object-contain bg-white p-0.5"
    />
  );
}
