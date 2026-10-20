import { BrandLockup, type BrandLockupProps } from "@/components/admin/core/BrandLockup";

export function DeliveryBrandLockup(props: BrandLockupProps) {
  return <BrandLockup {...props} logoSrc="/kada-delivery-logo.png" logoAlt="Kada Delivery" />;
}
