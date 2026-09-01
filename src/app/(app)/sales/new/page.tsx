import { BillBuilder } from '@/components/sales/bill-builder';
import { requireSessionShop } from '@/lib/auth/session';
import { getShopInventory } from '@/lib/data/inventory';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'New bill · PartLoop' };

export default async function NewBillPage() {
  const shop = await requireSessionShop();
  const lines = await getShopInventory(shop.id);

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">New counter bill</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Tap parts to add them to the bill — a customer buying three things at once is one bill and
          one Razorpay charge. Adjust quantities and prices, then take the payment by QR.
        </p>
      </header>

      <BillBuilder lines={lines} />
    </div>
  );
}
