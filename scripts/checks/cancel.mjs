/**
 * Cancellation assertions for `npm run db:verify`.
 *
 * The dangerous cases here are the reversals: cancelling a stocked bill must put
 * stock back exactly once, and a cancelled bill must stop counting as takings.
 * Both are easy to get subtly wrong and neither is visible until the month's
 * numbers are already wrong.
 */
export async function cancelChecks({ db, check, shopA, otherShop }) {
  console.log('\nCancelling bills:');

  const parts = (
    await db.query(
      `select part_id, quantity, price_paise
         from inventory
        where shop_id = $1 and quantity >= 3
        order by part_id
        limit 2`,
      [shopA.id],
    )
  ).rows;

  if (parts.length < 2) {
    check('two stocked parts available for cancel tests', false);
    return;
  }

  const nextNumber = async () =>
    (await db.query('select public.next_bill_number($1) as n', [shopA.id])).rows[0].n;

  const stockOf = async (partId) =>
    (
      await db.query('select quantity from inventory where shop_id = $1 and part_id = $2', [
        shopA.id,
        partId,
      ])
    ).rows[0].quantity;

  async function makeBill({ status, method, qty, partId, cut }) {
    const n = await nextNumber();
    const bill = (
      await db.query(
        `insert into bills (shop_id, bill_number, total_paise, status, payment_method, paid_at)
         values ($1, $2, 1000, $3, $4, case when $3 = 'created' then null else now() end)
         returning *`,
        [shopA.id, n, status, method],
      )
    ).rows[0];

    await db.query(
      `insert into transactions
         (type, seller_shop_id, part_id, quantity, amount_paise, status, bill_id, payment_method)
       values ('retail_sale', $1, $2, $3, 1000, $4, $5, $6)`,
      [shopA.id, partId, qty, status === 'created' ? 'created' : 'paid', bill.id, method],
    );

    if (cut) await db.query('select * from public.deduct_bill_stock($1, $2)', [bill.id, shopA.id]);
    return bill;
  }

  // ---- Case 1: void an unpaid bill ----------------------------------------
  const beforeUnpaid = await stockOf(parts[0].part_id);
  const unpaid = await makeBill({
    status: 'created',
    method: 'razorpay',
    qty: 2,
    partId: parts[0].part_id,
    cut: false,
  });

  const voided = (
    await db.query('select * from public.cancel_bill($1, $2, $3)', [
      unpaid.id,
      shopA.id,
      'wrong items',
    ])
  ).rows[0];

  check(
    'voiding an unpaid bill reports its previous status',
    voided.previous_status === 'created' && voided.already_cancelled === false,
    `previous=${voided.previous_status}`,
  );
  check(
    'voiding an unpaid bill touches no stock',
    (await stockOf(parts[0].part_id)) === beforeUnpaid,
    `${beforeUnpaid} -> ${await stockOf(parts[0].part_id)}`,
  );

  const unpaidRow = (
    await db.query('select status, cancelled_at, cancel_reason from bills where id = $1', [unpaid.id])
  ).rows[0];
  check(
    'a voided bill is marked cancelled with a timestamp and reason',
    unpaidRow.status === 'cancelled' &&
      unpaidRow.cancelled_at !== null &&
      unpaidRow.cancel_reason === 'wrong items',
  );

  const unpaidLines = (
    await db.query('select distinct status from transactions where bill_id = $1', [unpaid.id])
  ).rows.map((r) => r.status);
  check(
    "an unpaid bill's lines become 'cancelled', not 'refunded'",
    unpaidLines.length === 1 && unpaidLines[0] === 'cancelled',
    unpaidLines.join(','),
  );

  // ---- Case 2: reverse a paid, stocked bill -------------------------------
  const beforeStocked = await stockOf(parts[1].part_id);
  const stocked = await makeBill({
    status: 'paid',
    method: 'cash',
    qty: 2,
    partId: parts[1].part_id,
    cut: true,
  });

  const afterCut = await stockOf(parts[1].part_id);
  check(
    'setup: cutting stock reduced it',
    afterCut === beforeStocked - 2,
    `${beforeStocked} -> ${afterCut}`,
  );

  const reversed = (
    await db.query('select * from public.cancel_bill($1, $2, null)', [stocked.id, shopA.id])
  ).rows[0];

  check(
    'reversing a stocked bill restores the stock',
    (await stockOf(parts[1].part_id)) === beforeStocked,
    `${afterCut} -> ${await stockOf(parts[1].part_id)} (want ${beforeStocked})`,
  );
  check(
    'reversal reports the pre-cancel status',
    reversed.previous_status === 'stocked',
    `got ${reversed.previous_status}`,
  );

  const stockedLines = (
    await db.query('select distinct status from transactions where bill_id = $1', [stocked.id])
  ).rows.map((r) => r.status);
  check(
    "a paid bill's lines become 'refunded', not 'cancelled'",
    stockedLines.length === 1 && stockedLines[0] === 'refunded',
    stockedLines.join(','),
  );

  const clearedFlag = (
    await db.query('select stock_deducted_at from bills where id = $1', [stocked.id])
  ).rows[0].stock_deducted_at;
  check('reversal clears stock_deducted_at so the state is not self-contradictory', clearedFlag === null);

  // ---- Case 3: idempotency ------------------------------------------------
  const beforeSecond = await stockOf(parts[1].part_id);
  const again = (
    await db.query('select * from public.cancel_bill($1, $2, null)', [stocked.id, shopA.id])
  ).rows[0];

  check('cancelling twice reports already_cancelled', again.already_cancelled === true);
  check(
    'cancelling twice does NOT restore stock twice',
    (await stockOf(parts[1].part_id)) === beforeSecond,
    `${beforeSecond} -> ${await stockOf(parts[1].part_id)}`,
  );

  // ---- Case 4: ownership --------------------------------------------------
  let refused = false;
  try {
    await db.query('select * from public.cancel_bill($1, $2, null)', [unpaid.id, otherShop.id]);
  } catch {
    refused = true;
  }
  check("another shop cannot cancel this shop's bill", refused);

  // ---- Case 5: cancelled money is not takings -----------------------------
  const counted = (
    await db.query(
      `select count(*)::int as n
         from transactions
        where bill_id = any($1)
          and status in ('paid', 'on_hold', 'released', 'completed')`,
      [[unpaid.id, stocked.id]],
    )
  ).rows[0].n;
  check(
    'no cancelled line still counts as settled revenue',
    counted === 0,
    `${counted} rows would still be summed`,
  );
}
