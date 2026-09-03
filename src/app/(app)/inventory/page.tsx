import { InventoryClient } from '@/components/inventory/inventory-client';
import { requireSessionShop } from '@/lib/auth/session';
import { LOW_STOCK_THRESHOLD } from '@/lib/data/dashboard';
import { getShopInventory, listPartCategories } from '@/lib/data/inventory';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'My stock · PartLoop' };

export default async function InventoryPage() {
  const shop = await requireSessionShop();
  const [lines, categories] = await Promise.all([
    getShopInventory(shop.id),
    listPartCategories(),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">My stock</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {lines.length} parts listed. Saving a line refreshes its &ldquo;verified&rdquo; timestamp —
          that is the freshness other shops see when they search, so keeping it current is what makes
          your listings worth reserving.
        </p>
      </header>

      <InventoryClient
        lines={lines}
        lowStockThreshold={LOW_STOCK_THRESHOLD}
        categories={categories}
      />
    </div>
  );
}
