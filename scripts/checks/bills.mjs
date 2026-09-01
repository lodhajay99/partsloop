/**
 * Counter-bill assertions for `npm run db:verify`.
 *
 * The rule that matters here: paying a bill must NOT move stock. Payment and
 * handover are separate events, the shopkeeper confirms the second one, and
 * confirming twice must not deduct twice.
 *
 * Receives the harness context rather than opening its own database, so these
 * run against the same migrated+seeded instance as everything else.
 */
export async function billChecks({ db, check, rejects, shopA, otherShop }) {
  console.log('\nCounter bills:');

  const billParts = (
    await db.query(
      `select i.part_id, i.quantity, i.price_paise
         from inventory i
        where i.shop_id = $1 and i.quantity >= 4
        order by i.part_id
        limit 2`,
      [shopA.id],
    )
  ).rows;

  check('the demo shop has two stocked parts to bill', billParts.length === 2);
  if (billParts.length < 2) return;

  // The seed already fills a month of bills, so the assertion is about
  // continuing a shop's own book, not about starting from 1.
  const maxFor = async (shopId) =>
    (await db.query('select coalesce(max(bill_number), 0) as n from bills where shop_id = $1', [shopId]))
      .rows[0].n;

  const shopAMax = await maxFor(shopA.id);
  const firstNumber = (await db.query('select public.next_bill_number($1) as n', [shopA.id])).rows[0].n;
  check(
    "the next bill number continues the shop's own book",
    firstNumber === shopAMax + 1,
    `max ${shopAMax}, next ${firstNumber}`,
  );

  const total = billParts[0].price_paise * 2 + billParts[1].price_paise;
  const bill = (
    await db.query(
      `insert into bills (shop_id, bill_number, total_paise, status)
       values ($1, $2, $3, 'created') returning *`,
      [shopA.id, firstNumber, total],
    )
  ).rows[0];

  await db.query(
    `insert into transactions (type, seller_shop_id, part_id, quantity, amount_paise, status, bill_id)
     values ('retail_sale', $1, $2, 2, $3, 'created', $4),
            ('retail_sale', $1, $5, 1, $6, 'created', $4)`,
    [
      shopA.id,
      billParts[0].part_id,
      billParts[0].price_paise * 2,
      bill.id,
      billParts[1].part_id,
      billParts[1].price_paise,
    ],
  );

  const nextNumber = (await db.query('select public.next_bill_number($1) as n', [shopA.id])).rows[0].n;
  check('the next bill number increments', nextNumber === firstNumber + 1, `got ${nextNumber}`);

  // Each shop numbers its own bills: the other shop's next number tracks its own
  // max, and is unaffected by the bill just inserted for shopA.
  const otherMax = await maxFor(otherShop.id);
  const otherNumber = (await db.query('select public.next_bill_number($1) as n', [otherShop.id])).rows[0].n;
  check(
    'bill numbers are per shop, not global',
    otherNumber === otherMax + 1 && otherNumber !== nextNumber,
    `shopA next ${nextNumber}, other next ${otherNumber} (its max ${otherMax})`,
  );

  await rejects(
    'two bills cannot share a number within one shop',
    'insert into bills (shop_id, bill_number, total_paise) values ($1, $2, 100)',
    [shopA.id, firstNumber],
  );

  await rejects(
    'an unknown bill status is rejected',
    `insert into bills (shop_id, bill_number, total_paise, status)
     values ($1, 900, 100, 'sort_of_paid')`,
    [shopA.id],
  );

  const partIds = [billParts[0].part_id, billParts[1].part_id];
  const readStock = async () =>
    Object.fromEntries(
      (
        await db.query(
          'select part_id, quantity from inventory where shop_id = $1 and part_id = any($2)',
          [shopA.id, partIds],
        )
      ).rows.map((r) => [r.part_id, r.quantity]),
    );

  const before = await readStock();

  // Cutting stock before the money arrives is a bug, not a shortcut.
  let refusedEarly = false;
  try {
    await db.query('select * from public.deduct_bill_stock($1, $2)', [bill.id, shopA.id]);
  } catch {
    refusedEarly = true;
  }
  check('stock cannot be cut before the bill is paid', refusedEarly);

  await db.query("update bills set status = 'paid', paid_at = now() where id = $1", [bill.id]);
  await db.query("update transactions set status = 'paid' where bill_id = $1", [bill.id]);

  const afterPayment = await readStock();
  check(
    'paying a bill does NOT move stock on its own',
    JSON.stringify(before) === JSON.stringify(afterPayment),
    JSON.stringify(afterPayment),
  );

  const cut = (await db.query('select * from public.deduct_bill_stock($1, $2)', [bill.id, shopA.id]))
    .rows[0];
  check(
    'cutting stock touches one row per distinct part',
    cut.lines_deducted === 2 && cut.already_done === false,
    `${cut.lines_deducted} rows, already_done=${cut.already_done}`,
  );

  const afterCut = await readStock();
  check(
    'each line is deducted by its own quantity',
    afterCut[partIds[0]] === before[partIds[0]] - 2 && afterCut[partIds[1]] === before[partIds[1]] - 1,
    JSON.stringify(afterCut),
  );

  const again = (await db.query('select * from public.deduct_bill_stock($1, $2)', [bill.id, shopA.id]))
    .rows[0];
  check(
    'cutting stock twice is a no-op, not a double deduction',
    again.already_done === true && again.lines_deducted === 0,
  );

  const afterSecondCut = await readStock();
  check(
    'the second cut left stock untouched',
    JSON.stringify(afterSecondCut) === JSON.stringify(afterCut),
    JSON.stringify(afterSecondCut),
  );

  const settled = (
    await db.query('select status, stock_deducted_at from bills where id = $1', [bill.id])
  ).rows[0];
  check(
    'a cut bill is marked stocked, with a timestamp',
    settled.status === 'stocked' && settled.stock_deducted_at !== null,
    settled.status,
  );

  const lineStatuses = (
    await db.query('select distinct status from transactions where bill_id = $1', [bill.id])
  ).rows.map((r) => r.status);
  check(
    'bill lines reach completed once stock is cut',
    lineStatuses.length === 1 && lineStatuses[0] === 'completed',
    lineStatuses.join(','),
  );

  // The same part can legitimately appear on two lines of one bill.
  const repeatPart = partIds[0];
  const beforeRepeat = (
    await db.query('select quantity from inventory where shop_id = $1 and part_id = $2', [
      shopA.id,
      repeatPart,
    ])
  ).rows[0].quantity;

  const repeatNumber = (await db.query('select public.next_bill_number($1) as n', [shopA.id])).rows[0]
    .n;
  const repeatBill = (
    await db.query(
      `insert into bills (shop_id, bill_number, total_paise, status, paid_at)
       values ($1, $2, 100, 'paid', now()) returning *`,
      [shopA.id, repeatNumber],
    )
  ).rows[0];

  await db.query(
    `insert into transactions (type, seller_shop_id, part_id, quantity, amount_paise, status, bill_id)
     values ('retail_sale', $1, $2, 1, 50, 'paid', $3),
            ('retail_sale', $1, $2, 1, 50, 'paid', $3)`,
    [shopA.id, repeatPart, repeatBill.id],
  );
  await db.query('select * from public.deduct_bill_stock($1, $2)', [repeatBill.id, shopA.id]);

  const afterRepeat = (
    await db.query('select quantity from inventory where shop_id = $1 and part_id = $2', [
      shopA.id,
      repeatPart,
    ])
  ).rows[0].quantity;
  check(
    'the same part on two lines is deducted once, summed',
    afterRepeat === Math.max(beforeRepeat - 2, 0),
    `${beforeRepeat} -> ${afterRepeat}`,
  );

  let wrongShopRefused = false;
  try {
    await db.query('select * from public.deduct_bill_stock($1, $2)', [repeatBill.id, otherShop.id]);
  } catch {
    wrongShopRefused = true;
  }
  check("another shop cannot cut a bill's stock", wrongShopRefused);

  // ---- Cash bills ---------------------------------------------------------
  //
  // Cash has no Razorpay record behind it, so the guarantee is different: the
  // bill must never claim one, and it must never sit in an unpaid state.
  console.log('\nCash bills:');

  const seededCash = (
    await db.query(
      `select
         count(*) filter (where payment_method = 'cash') as cash,
         count(*) filter (where payment_method = 'razorpay') as rzp,
         count(*) filter (where payment_method = 'cash' and razorpay_order_id is not null) as cash_with_ids,
         count(*) filter (where payment_method = 'razorpay' and razorpay_order_id is null) as rzp_without_ids
       from bills where is_seed`,
    )
  ).rows[0];

  check(
    'the seed mixes cash and Razorpay takings',
    Number(seededCash.cash) > 0 && Number(seededCash.rzp) > 0,
    `${seededCash.cash} cash, ${seededCash.rzp} Razorpay`,
  );
  check(
    'a cash bill never carries Razorpay ids',
    Number(seededCash.cash_with_ids) === 0,
    `${seededCash.cash_with_ids} offenders`,
  );
  check(
    'a Razorpay bill always carries Razorpay ids',
    Number(seededCash.rzp_without_ids) === 0,
    `${seededCash.rzp_without_ids} offenders`,
  );

  const methodDrift = (
    await db.query(
      `select count(*)::int as n
         from transactions t join bills b on b.id = t.bill_id
        where t.payment_method <> b.payment_method`,
    )
  ).rows[0].n;
  check('every line carries the same method as its bill', methodDrift === 0, `${methodDrift} drifted`);

  const interShopMethods = (
    await db.query(
      `select count(*)::int as n from transactions
        where type = 'inter_shop_purchase' and payment_method <> 'razorpay'`,
    )
  ).rows[0].n;
  check('shop-to-shop purchases are always Razorpay', interShopMethods === 0);

  await rejects(
    'a cash bill cannot sit awaiting payment',
    `insert into bills (shop_id, bill_number, total_paise, status, payment_method)
     values ($1, 901, 100, 'created', 'cash')`,
    [shopA.id],
  );

  await rejects(
    'an unknown payment method is rejected',
    `insert into bills (shop_id, bill_number, total_paise, status, payment_method)
     values ($1, 902, 100, 'paid', 'upi_maybe')`,
    [shopA.id],
  );

  // A cash bill goes paid -> stocked in one step, which the same function drives.
  const cashPart = (
    await db.query(
      'select part_id, quantity from inventory where shop_id = $1 and quantity >= 2 limit 1',
      [shopA.id],
    )
  ).rows[0];
  const beforeCash = cashPart.quantity;

  const cashNumber = (await db.query('select public.next_bill_number($1) as n', [shopA.id])).rows[0].n;
  const cashBill = (
    await db.query(
      `insert into bills (shop_id, bill_number, total_paise, status, payment_method, paid_at)
       values ($1, $2, 500, 'paid', 'cash', now()) returning *`,
      [shopA.id, cashNumber],
    )
  ).rows[0];
  await db.query(
    `insert into transactions (type, seller_shop_id, part_id, quantity, amount_paise, status, bill_id, payment_method)
     values ('retail_sale', $1, $2, 2, 500, 'paid', $3, 'cash')`,
    [shopA.id, cashPart.part_id, cashBill.id],
  );

  const cashCut = (
    await db.query('select * from public.deduct_bill_stock($1, $2)', [cashBill.id, shopA.id])
  ).rows[0];
  const afterCash = (
    await db.query('select quantity from inventory where shop_id = $1 and part_id = $2', [
      shopA.id,
      cashPart.part_id,
    ])
  ).rows[0].quantity;

  check(
    'a cash bill cuts stock through the same path',
    cashCut.already_done === false && afterCash === Math.max(beforeCash - 2, 0),
    `${beforeCash} -> ${afterCash}`,
  );

  const linesBefore = (
    await db.query('select count(*)::int as n from transactions where bill_id = $1', [bill.id])
  ).rows[0].n;
  await db.query('delete from bills where id = $1', [bill.id]);
  const linesAfter = (
    await db.query('select count(*)::int as n from transactions where bill_id = $1', [bill.id])
  ).rows[0].n;
  check(
    'deleting a bill takes its line items with it',
    linesBefore === 2 && linesAfter === 0,
    `${linesBefore} -> ${linesAfter}`,
  );
}
