import { useState } from 'react';
import { Check, ChevronsUpDown, Store, Lock, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from 'react-router-dom';

export function OutletSwitcher({ className }: { className?: string }) {
  const { outlets, restaurantId, setRestaurantId, isStaffOutlet, primaryOutletId } = useAuth();
  const { plan, loading } = useSubscription();
  const [open, setOpen] = useState(false);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);

  // Don't render anything if it's a staff account or if there's only one outlet and no global view needed
  if (isStaffOutlet || outlets.length <= 1) {
    return null;
  }

  if (loading) {
    return (
      <div className={cn("w-full h-10 animate-pulse bg-card border border-border/40 rounded-xl sm:w-[220px]", className)} />
    );
  }

  const isGlobal = restaurantId === 'global';
  const selectedOutlet = outlets.find((o) => o.id === restaurantId);
  const label = isGlobal ? 'All Outlets' : (selectedOutlet?.name || 'Select a location to manage');
  const isLocked = plan?.id === 'starter';

  if (isLocked) {
    return (
      <>
        <Button
          variant="outline"
          className={cn("w-full justify-between sm:w-[220px] rounded-xl bg-card border-border/40 font-bold shadow-sm cursor-pointer", className)}
          onClick={() => setUpgradeDialogOpen(true)}
        >
          <div className="flex items-center gap-2 truncate">
            <Store className="w-4 h-4 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </div>
          <Lock className="ml-2 h-3.5 w-3.5 shrink-0 text-amber-500 opacity-80" />
        </Button>

        <Dialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
          <DialogContent className="rounded-[28px] max-w-md p-6 text-center space-y-6">
            <DialogHeader>
              <div className="relative mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary/20 to-violet-500/20 flex items-center justify-center border border-primary/20">
                <Store className="w-8 h-8 text-primary" />
                <Lock className="absolute -bottom-1 -right-1 w-4 h-4 text-amber-500 bg-background border rounded-full p-0.5" />
              </div>
              <DialogTitle className="text-xl font-black mt-4">Multi-Outlet Locked</DialogTitle>
              <DialogDescription className="text-sm font-semibold text-muted-foreground mt-2 leading-relaxed">
                Your current <strong>Starter Plan</strong> only supports a single location. 
                Upgrade to the <strong>Growth Plan</strong> to manage multiple outlets and switch between them seamlessly.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setUpgradeDialogOpen(false)} className="flex-1 rounded-xl h-11 font-bold">
                Dismiss
              </Button>
              <Button asChild className="flex-1 rounded-xl h-11 font-bold bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 text-white border-0">
                <Link to="/dashboard/settings?tab=billing" onClick={() => setUpgradeDialogOpen(false)}>
                  Upgrade Plan
                </Link>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between sm:w-[220px] rounded-xl bg-card border-border/40 font-bold shadow-sm", className)}
        >
          <div className="flex items-center gap-2 truncate">
            {isGlobal
              ? <Building2 className="w-4 h-4 text-primary" />
              : <Store className="w-4 h-4 text-muted-foreground" />}
            <span className="truncate">{label}</span>
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0 rounded-xl" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No outlet found.</CommandEmpty>
            <CommandGroup heading="Overview">
              <CommandItem
                value="all-outlets-global"
                onSelect={() => {
                  setRestaurantId('global');
                  setOpen(false);
                }}
                className="font-semibold cursor-pointer"
              >
                <Building2 className="mr-2 h-4 w-4 text-primary" />
                All Outlets
                <span className="ml-1 text-[10px] text-muted-foreground opacity-70">(combined)</span>
                <Check
                  className={cn(
                    "ml-auto h-4 w-4",
                    isGlobal ? "opacity-100" : "opacity-0"
                  )}
                />
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Your Outlets">
              {outlets.map((outlet) => (
                <CommandItem
                  key={outlet.id}
                  value={outlet.id}
                  onSelect={() => {
                    setRestaurantId(outlet.id);
                    setOpen(false);
                  }}
                  className="font-medium cursor-pointer"
                >
                  <Store className={cn("mr-2 h-4 w-4", outlet.id === primaryOutletId ? "text-primary" : "text-muted-foreground")} />
                  {outlet.name}
                  {outlet.district && <span className="ml-1 text-[10px] text-muted-foreground opacity-70">({outlet.district})</span>}
                  {outlet.id === primaryOutletId && <span className="ml-1 text-[10px] text-muted-foreground opacity-50">(Main)</span>}
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      restaurantId === outlet.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
