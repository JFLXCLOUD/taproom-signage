import * as store from './db.js';

const DEMO_BOARD = {
  name: 'Main Bar',
  slug: 'main',
  ticker: 'Happy hour 4–6pm daily  •  Ask about our cask of the week  •  Kitchen open till 11',
  sections: [
    {
      name: 'On Draft',
      kind: 'draft',
      items: [
        { tap: '1', name: 'Pliny the Elder', style: 'Double IPA', producer: 'Russian River', origin: 'Santa Rosa, CA',
          abv: 8.0, ibu: 100, color: '#e0a422', badge: 'Rare',
          prices: [{ label: '10 oz', amount: '7' }, { label: '16 oz', amount: '9' }] },
        { tap: '2', name: 'Hazy Little Thing', style: 'Hazy IPA', producer: 'Sierra Nevada', origin: 'Chico, CA',
          abv: 6.7, ibu: 35, color: '#f0b64a',
          prices: [{ label: '16 oz', amount: '8' }, { label: 'Pitcher', amount: '26' }] },
        { tap: '3', name: 'Allagash White', style: 'Witbier', producer: 'Allagash', origin: 'Portland, ME',
          abv: 5.2, ibu: 13, color: '#f7d978',
          prices: [{ label: '16 oz', amount: '7' }] },
        { tap: '4', name: 'Guinness Draught', style: 'Irish Dry Stout', producer: 'Guinness', origin: 'Dublin, IE',
          abv: 4.2, ibu: 45, color: '#2b1a12',
          prices: [{ label: '20 oz', amount: '8' }] },
        { tap: '5', name: 'Modelo Especial', style: 'Mexican Lager', producer: 'Grupo Modelo', origin: 'Mexico',
          abv: 4.4, ibu: 18, color: '#f3d98b',
          prices: [{ label: '16 oz', amount: '6' }] },
        { tap: '6', name: 'Two Hearted Ale', style: 'American IPA', producer: "Bell's", origin: 'Kalamazoo, MI',
          abv: 7.0, ibu: 55, color: '#d98e2b', status: 'low',
          prices: [{ label: '16 oz', amount: '8' }] },
        { tap: '7', name: 'Prairie Bomb!', style: 'Imperial Stout', producer: 'Prairie Artisan', origin: 'Tulsa, OK',
          abv: 13.0, ibu: 60, color: '#1a0f0a', badge: 'Limited',
          prices: [{ label: '8 oz', amount: '11' }] },
        { tap: '8', name: 'Dry Cider', style: 'Cider', producer: 'Golden State', origin: 'Sonoma, CA',
          abv: 6.9, color: '#f5c95c',
          prices: [{ label: '16 oz', amount: '8' }] },
        { tap: '9', name: 'Pilsner Urquell', style: 'Czech Pilsner', producer: 'Plzeňský', origin: 'Plzeň, CZ',
          abv: 4.4, ibu: 40, color: '#efc75e',
          prices: [{ label: '16 oz', amount: '7' }] },
        { tap: '10', name: 'Seasonal Cask', style: 'Ask your bartender', producer: 'Rotating', origin: '',
          abv: null, status: 'soon', badge: 'Tapping Friday',
          prices: [{ label: '16 oz', amount: '9' }] }
      ]
    },
    {
      name: 'Cocktails',
      kind: 'cocktail',
      items: [
        { name: 'Old Fashioned', style: 'Bourbon, demerara, angostura', prices: [{ label: '', amount: '13' }] },
        { name: 'Paper Plane', style: 'Bourbon, Aperol, Nonino, lemon', prices: [{ label: '', amount: '14' }] },
        { name: 'Espresso Martini', style: 'Vodka, cold brew, coffee liqueur', prices: [{ label: '', amount: '14' }] },
        { name: 'Spicy Margarita', style: 'Blanco tequila, lime, jalapeño', prices: [{ label: '', amount: '13' }] }
      ]
    },
    {
      name: 'Kitchen',
      kind: 'food',
      items: [
        { name: 'Smash Burger', style: 'Double patty, aged cheddar, house sauce', prices: [{ label: '', amount: '14' }] },
        { name: 'Wings', style: 'Buffalo / BBQ / dry rub — 10 pc', prices: [{ label: '', amount: '12' }] },
        { name: 'Loaded Fries', style: 'Bacon, queso, scallion', prices: [{ label: '', amount: '10' }] },
        { name: 'Soft Pretzel', style: 'Beer cheese, stone mustard', prices: [{ label: '', amount: '9' }] },
        { name: 'Fish & Chips', style: 'Beer battered cod, malt vinegar', prices: [{ label: '', amount: '17' }] }
      ]
    }
  ]
};

/** Populate a first board so a fresh install shows something real on screen. */
export function seedDemo() {
  const board = store.createBoard({
    name: DEMO_BOARD.name, slug: DEMO_BOARD.slug, ticker: DEMO_BOARD.ticker, layout: 'grid'
  });
  for (const s of DEMO_BOARD.sections) {
    const section = store.createSection(board.id, { name: s.name, kind: s.kind });
    for (const item of s.items) store.createItem(section.id, item);
  }
  store.updateSettings({
    venue_name: 'The Tap Room',
    tagline: 'Craft beer & kitchen',
    theme: { preset: 'midnight' }
  });
  return board;
}

export function maybeSeed() {
  if (process.env.SEED_DEMO === '0') return;
  if (store.listBoards().length > 0) return;
  const board = seedDemo();
  console.log(`  Seeded demo board "${board.name}" (/d/${board.slug}).`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const board = seedDemo();
  console.log('Seeded demo board:', board.slug);
}
