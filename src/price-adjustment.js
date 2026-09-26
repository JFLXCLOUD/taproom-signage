// Currency calculations use integer cents; percentages allow two decimal places.
export function planPriceIncrease(sections, percent, rounding = 'cent') {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 1000 ||
      Math.abs(percent * 100 - Math.round(percent * 100)) > 1e-8) {
    throw new Error('Enter a percentage greater than 0 and no more than 1000, with up to two decimal places.');
  }
  const increments = { cent: 1, nickel: 5, quarter: 25, dollar: 100 };
  if (typeof rounding !== 'string' || !Object.hasOwn(increments, rounding)) throw new Error('Choose a valid rounding option.');
  const increment = increments[rounding];
  const changes = [], skipped = [];
  for (const section of sections) for (const item of section.items) {
    for (const price of item.prices) {
      const raw = String(price.amount).trim();
      const label = [section.name, item.name, price.label].filter(Boolean).join(' / ');
      if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) {
        skipped.push({ label, amount: price.amount });
        continue;
      }
      const [whole, fraction = ''] = raw.split('.');
      const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      const numerator = cents * (10000 + Math.round(percent * 100));
      // Round half up, but never reduce a price when applying an increase.
      const next = Math.max(cents, Math.floor((numerator + increment * 5000) / (increment * 10000)) * increment);
      if (next > 999999999) throw new Error('An adjusted price exceeds the supported amount.');
      if (next !== cents) changes.push({ id: price.id, itemId: item.id, label, before: price.amount, after: (next / 100).toFixed(2) });
    }
  }
  return { changes, skipped };
}
