/**
 * Processing-fee assertions for `npm run db:verify`.
 *
 * The rule this protects: the surcharge is money for Razorpay, never revenue
 * for the shop. If it ever leaks into amount_paise, every dashboard figure
 * overstates what the shop actually earned — and it would look plausible, which
 * is what makes it worth an assertion.
 */
export async function processingFeeChecks({ db, check, rejects, shopA }) {
  console.log('\nProcessing fee:');

  const part = (
    await db.query('select part_id from inventory where shop_id = $1 limit 1', [shopA.id])
  ).rows[0];

  const nextNumber = async () =>
    (await db.query('select public.next_bill_number($1) as n', [shopA.id])).rows[0].n;

  // A cash bill must never carry a surcharge — there is no processor involved.
  await rejects(
    'a cash bill cannot carry a processing fee',
    `insert into bills (shop_id, bill_number, total_paise, status, payment_method, processing_fee_paise, paid_at)
     values ($1, $2, 1000, 'paid', 'cash', 26, now())`,
    [shopA.id, await nextNumber()],
  );

  await rejects(
    'a negative processing fee is rejected',
    `insert into bills (shop_id, bill_number, total_paise, status, payment_method, processing_fee_paise)
     values ($1, $2, 1000, 'created', 'razorpay', -1)`,
    [shopA.id, await nextNumber()],
  );

  // A Razorpay bill may carry one.
  const n = await nextNumber();
  const bill = (
    await db.query(
      `insert into bills (shop_id, bill_number, total_paise, status, payment_method, processing_fee_paise)
       values ($1, $2, 100000, 'created', 'razorpay', 2600) returning *`,
      [shopA.id, n],
    )
  ).rows[0];

  check(
    'a Razorpay bill stores the surcharge alongside the goods total',
    bill.total_paise === 100000 && bill.processing_fee_paise === 2600,
    `goods ${bill.total_paise}, fee ${bill.processing_fee_paise}`,
  );

  check(
    'the customer is charged goods + surcharge',
    bill.total_paise + bill.processing_fee_paise === 102600,
  );

  await db.query(
    `insert into transactions
       (type, seller_shop_id, part_id, quantity, amount_paise, status, bill_id, payment_method)
     values ('retail_sale', $1, $2, 1, 100000, 'created', $3, 'razorpay')`,
    [shopA.id, part.part_id, bill.id],
  );

  // The line items must sum to the GOODS total, not the charged total.
  const lineSum = (
    await db.query('select coalesce(sum(amount_paise), 0)::int as s from transactions where bill_id = $1', [
      bill.id,
    ])
  ).rows[0].s;
  check(
    'line items sum to the goods total, so revenue excludes the surcharge',
    lineSum === bill.total_paise,
    `${lineSum} vs goods ${bill.total_paise}`,
  );

  // Existing rows must have defaulted to zero rather than null.
  const nulls = (
    await db.query(
      `select count(*)::int as n from bills where processing_fee_paise is null
       union all
       select count(*)::int from transactions where processing_fee_paise is null`,
    )
  ).rows.reduce((a, r) => a + r.n, 0);
  check('no row has a null processing fee', nulls === 0, `${nulls} nulls`);

  // Seeded history predates the surcharge and must not have acquired one.
  const seeded = (
    await db.query(
      `select count(*)::int as n from bills where is_seed and processing_fee_paise <> 0`,
    )
  ).rows[0].n;
  check(
    'backdated seed bills carry no surcharge',
    seeded === 0,
    `${seeded} seeded bills would have been restated`,
  );

  await db.query('delete from bills where id = $1', [bill.id]);
}
