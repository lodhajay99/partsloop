/**
 * Reservation-decline assertions for `npm run db:verify`.
 *
 * The guarantees worth pinning: only the two shops involved can call it off,
 * only while it is unpaid, and a declined reservation must genuinely free the
 * part rather than leaving it half-held.
 */
export async function declineChecks({ db, check, shopA, otherShop }) {
  console.log('\nDeclining a reservation:');

  const part = (
    await db.query('select part_id from inventory where shop_id = $1 and quantity > 0 limit 1', [
      otherShop.id,
    ])
  ).rows[0];

  const thirdShop = (
    await db.query('select id, name from shops where id not in ($1, $2) limit 1', [
      shopA.id,
      otherShop.id,
    ])
  ).rows[0];

  // otherShop sells, shopA buys.
  async function makeReservation(status = 'reserved') {
    return (
      await db.query(
        `insert into transactions
           (type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise, status, hold_until)
         values ('inter_shop_purchase', $1, $2, $3, 1, 100000, $4, now() + interval '30 minutes')
         returning *`,
        [otherShop.id, shopA.id, part.part_id, status],
      )
    ).rows[0];
  }

  const stockBefore = (
    await db.query('select quantity from inventory where shop_id = $1 and part_id = $2', [
      otherShop.id,
      part.part_id,
    ])
  ).rows[0].quantity;

  // ---- the seller declines -------------------------------------------------
  const r1 = await makeReservation();
  const declined = (
    await db.query('select * from public.cancel_reservation($1, $2, $3)', [
      r1.id,
      otherShop.id,
      'already promised to a customer',
    ])
  ).rows[0];

  check(
    'the seller can decline, and it is recorded as the seller',
    declined.cancelled_by_seller === true && declined.already_cancelled === false,
    `by_seller=${declined.cancelled_by_seller}`,
  );

  const r1row = (
    await db.query(
      'select status, cancel_reason, cancelled_by_shop_id, hold_until from transactions where id = $1',
      [r1.id],
    )
  ).rows[0];
  check(
    'a declined reservation is cancelled, with reason and author',
    r1row.status === 'cancelled' &&
      r1row.cancel_reason === 'already promised to a customer' &&
      r1row.cancelled_by_shop_id === otherShop.id,
    r1row.status,
  );
  check(
    'declining clears the hold window so it cannot look live',
    r1row.hold_until === null,
  );
  check(
    'declining does not touch stock — a reservation never held any',
    (await db.query('select quantity from inventory where shop_id = $1 and part_id = $2', [
      otherShop.id,
      part.part_id,
    ])).rows[0].quantity === stockBefore,
  );

  // ---- idempotency ---------------------------------------------------------
  const again = (
    await db.query('select * from public.cancel_reservation($1, $2, null)', [r1.id, otherShop.id])
  ).rows[0];
  check('declining twice reports already_cancelled', again.already_cancelled === true);

  // ---- the buyer can also withdraw ----------------------------------------
  const r2 = await makeReservation();
  const withdrawn = (
    await db.query('select * from public.cancel_reservation($1, $2, null)', [r2.id, shopA.id])
  ).rows[0];
  check(
    'the buyer can withdraw, and it is not recorded as the seller',
    withdrawn.cancelled_by_seller === false && withdrawn.already_cancelled === false,
  );

  // ---- an outsider cannot ---------------------------------------------------
  const r3 = await makeReservation();
  let outsiderRefused = false;
  try {
    await db.query('select * from public.cancel_reservation($1, $2, null)', [r3.id, thirdShop.id]);
  } catch {
    outsiderRefused = true;
  }
  check('a shop that is not a party cannot call it off', outsiderRefused);

  // ---- a paid reservation cannot simply be called off ----------------------
  await db.query("update transactions set status = 'on_hold' where id = $1", [r3.id]);
  let paidRefused = false;
  try {
    await db.query('select * from public.cancel_reservation($1, $2, null)', [r3.id, otherShop.id]);
  } catch {
    paidRefused = true;
  }
  check('a paid reservation is refused — that needs a refund, not a cancel', paidRefused);

  // ---- a counter bill is not a reservation ---------------------------------
  const billLine = (
    await db.query(
      `insert into transactions (type, seller_shop_id, part_id, quantity, amount_paise, status)
       values ('retail_sale', $1, $2, 1, 500, 'created') returning id`,
      [shopA.id, part.part_id],
    )
  ).rows[0];
  let wrongType = false;
  try {
    await db.query('select * from public.cancel_reservation($1, $2, null)', [billLine.id, shopA.id]);
  } catch {
    wrongType = true;
  }
  check('a counter-sale row is refused by the reservation path', wrongType);

  await db.query('delete from transactions where id = any($1)', [[r1.id, r2.id, r3.id, billLine.id]]);
}
