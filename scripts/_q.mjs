import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/)
  .filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} });
await c.connect();
const seller='a1df8545-115e-44ae-ac63-ddc5da2cd456';  // Balaji Motor Parts
const buyer='7cbd5b21-42db-4d02-a5a1-8a6dfb0e2417';   // Pune Spare Centre
const part=(await c.query('select part_id from inventory where shop_id=$1 and quantity>0 limit 1',[seller])).rows[0].part_id;
const r = await c.query(`insert into transactions
  (type, seller_shop_id, buyer_shop_id, part_id, quantity, amount_paise, processing_fee_paise, status, simulated, paid_at, razorpay_transfer_id)
  values ('inter_shop_purchase',$1,$2,$3,1,100000,2600,'on_hold',true,now(),'trf_SIMPROBE') returning id`,[seller,buyer,part]);
console.log('PROBE_TX=' + r.rows[0].id);
await c.end();
