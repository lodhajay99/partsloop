import { SearchClient } from '@/components/search/search-client';
import { requireSessionShop } from '@/lib/auth/session';
import { expireStaleReservations } from '@/lib/data/fulfilment';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Find a part nearby · PartLoop' };

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const shop = await requireSessionShop();
  await expireStaleReservations();

  const params = await searchParams;
  const initialQuery = typeof params.q === 'string' ? params.q : '';

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Find a part nearby</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Searches every other shop&apos;s live stock within 25 km. Matching is fuzzy — misspellings,
          Hindi-English mixes and model/year variants all resolve to the same part. Sellers stay
          anonymous until you reserve.
        </p>
      </header>

      <SearchClient
        origin={{ lat: shop.lat, lng: shop.lng, name: shop.name }}
        initialQuery={initialQuery}
      />
    </div>
  );
}
