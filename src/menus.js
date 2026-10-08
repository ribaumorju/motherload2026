/**
 * The screens around the game: title, pause, the supply station, the end.
 *
 * These are DOM overlays rather than canvas because they are forms - they have
 * buttons, tabs, prices, focus order and a scroll bar on a short screen, and
 * rebuilding all of that in canvas would be a worse version of the browser.
 *
 * The shop is built from the same tables the sim spends money against, so a
 * price shown here cannot drift from the price charged.
 */

import {
  UPGRADES, UPGRADE_KEYS, MAX_TIER, ITEMS, FUEL_PRICE, REPAIR_PRICE,
} from './config.js';
import {
  upgradeTier, maxFuel, maxHull, buyUpgrade, buyItem, refuel, repair,
  sellCargo, cargoValue, cargoManifest, drillPower,
} from './sim/game.js';

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/** A tiny DOM builder, so the markup below stays readable. */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * A modal shell: backdrop, panel, title, close. Returns the panel so the caller
 * can put whatever it likes inside, and handles Escape and backdrop clicks.
 */
function modal(root, { title, subtitle, wide = false, onClose }) {
  const panel = h('div', { class: `modal-panel${wide ? ' is-wide' : ''}` });
  const backdrop = h('div', { class: 'modal' },
    h('div', { class: 'modal-card' },
      h('header', { class: 'modal-head' },
        h('div', {},
          h('h2', { text: title }),
          subtitle ? h('p', { class: 'modal-sub', text: subtitle }) : null,
        ),
        h('button', {
          class: 'icon-btn modal-close',
          type: 'button',
          'aria-label': 'Close',
          onclick: () => close(),
        }, '\u2715'),
      ),
      panel,
    ));

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  }
  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  root.append(backdrop);

  // Focus the first control so the modal is usable from the keyboard alone.
  const focusable = backdrop.querySelector('button');
  if (focusable) focusable.focus();

  return { backdrop, panel, close };
}

/* ------------------------------------------------------------------ */
/* Title                                                               */
/* ------------------------------------------------------------------ */

export function showTitle(root, { onStart, onContinue, hasSave, onHelp }) {
  const card = h('div', { class: 'modal-card title-card' },
    h('h1', { class: 'title-name' },
      h('span', { class: 'title-deep', text: 'DEEP' }),
      h('span', { class: 'title-core', text: 'CORE' }),
    ),
    h('p', { class: 'title-tag', text: 'The mine goes down 12,800 feet. It does not go back up.' }),
    h('div', { class: 'title-actions' },
      hasSave
        ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { remove(); onContinue(); } }, 'CONTINUE')
        : null,
      h('button', {
        class: hasSave ? 'btn' : 'btn btn-primary',
        type: 'button',
        onclick: () => { remove(); onStart(); },
      }, hasSave ? 'NEW MINE' : 'START DRILLING'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: onHelp }, 'HOW TO PLAY'),
    ),
    h('p', { class: 'title-foot', text: 'A modern remake of Motherload. Arrows or WASD to fly, hold Space to drill.' }),
  );
  const backdrop = h('div', { class: 'modal modal-title' }, card);
  root.append(backdrop);
  const remove = () => backdrop.remove();
  return { close: remove };
}

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */

export function showHelp(root, onClose) {
  const rows = [
    ['Move', 'Arrow keys or WASD'],
    ['Drill', 'Push into rock - the bit cuts whichever way you are pointing'],
    ['Drill down', 'Hold Space (or Shift / J) to cut straight down on the spot'],
    ['Dock', 'Stand under a building, press E'],
    ['Pause', 'Esc'],
    ['Mute', 'M'],
    ['Phone', 'Left half of the screen is a stick, right half drills'],
  ];
  const table = h('div', { class: 'help-grid' },
    rows.flatMap(([k, v]) => [
      h('span', { class: 'help-key', text: k }),
      h('span', { class: 'help-val', text: v }),
    ]));

  const goals = h('ul', { class: 'help-list' },
    h('li', { text: 'Dig for ore. Your hold is measured in kilograms, not in tiles - the heavy cheap stuff fills it fast.' }),
    h('li', { text: 'Sell at the Mineral Processor. Fuel up and repair at the depot and the supply station.' }),
    h('li', { text: 'Green seams are gas. They look like rock until your drill touches one. They hurt.' }),
    h('li', { text: 'Orange pools are lava. The drill will not cut them and getting close cooks you, so go around - or blow a hole with explosives.' }),
    h('li', { text: 'You can drill up. It is slower and dearer than flying, but it is the way out if you drop into a cavern.' }),
    h('li', { text: 'Running out of fuel or wrecking the hull costs you the hold, never your upgrades.' }),
    h('li', { text: 'Something is at the bottom of the mine. It has been waiting.' }),
  );

  const m = modal(root, { title: 'How to play', subtitle: 'Two verbs: fly, and dig. Everything else is consequences.' });
  m.panel.append(table, h('h3', { class: 'help-head', text: 'The loop' }), goals,
    h('div', { class: 'modal-actions' },
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => { m.close(); if (onClose) onClose(); },
      }, 'GOT IT')));
  return m;
}

/* ------------------------------------------------------------------ */
/* Pause                                                               */
/* ------------------------------------------------------------------ */

export function showPause(root, { onResume, onSave, onQuit, muted, onToggleSound }) {
  const m = modal(root, { title: 'Paused', subtitle: 'The mine is not going anywhere.', onClose: onResume });
  m.panel.append(h('div', { class: 'modal-actions column' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'RESUME'),
    h('button', { class: 'btn', type: 'button', onclick: () => { onSave(); } }, 'SAVE NOW'),
    h('button', {
      class: 'btn',
      type: 'button',
      onclick: (event) => {
        onToggleSound();
        event.currentTarget.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
      },
    }, muted ? 'SOUND: OFF' : 'SOUND: ON'),
    h('button', {
      class: 'btn btn-danger',
      type: 'button',
      onclick: () => { m.close(); onQuit(); },
    }, 'QUIT TO TITLE'),
  ));
  return m;
}

/* ------------------------------------------------------------------ */
/* The supply station                                                  */
/* ------------------------------------------------------------------ */

/**
 * Three tabs: the ship, the consumables, and the counter where you refuel,
 * repair and sell. Everything the player can buy is on one screen with its
 * price and its effect, because a shop you have to memorise is a shop you avoid.
 */
export function showShop(root, state, { onSpend, onClose, initialTab = 'ship' }) {
  const m = modal(root, {
    title: 'Supply Station',
    subtitle: 'Buy the next tier. Everything is permanent.',
    wide: true,
    onClose,
  });

  const body = h('div', { class: 'shop' });
  const tabs = h('div', { class: 'tabs' });
  const panes = {
    ship: h('div', { class: 'pane' }),
    gear: h('div', { class: 'pane' }),
    counter: h('div', { class: 'pane' }),
  };
  let active = initialTab;

  const rebuild = () => {
    const cashTag = h('div', { class: 'shop-cash' },
      h('span', { text: 'CREDITS' }), h('strong', { text: money(state.cash) }));

    tabs.textContent = '';
    for (const [key, label] of [['ship', 'SHIP'], ['gear', 'SUPPLIES'], ['counter', 'COUNTER']]) {
      tabs.append(h('button', {
        class: `tab${key === active ? ' is-active' : ''}`,
        type: 'button',
        onclick: () => { active = key; rebuild(); },
      }, label));
    }

    // Only the active pane is shown; the rest stay built so switching a tab
    // does not rebuild the whole shop.
    for (const [key, pane] of Object.entries(panes)) {
      pane.classList.toggle('is-active', key === active);
    }

    /* --- ship: the six ladders --- */
    const ship = panes.ship;
    ship.textContent = '';
    ship.append(cashTag);
    for (const key of UPGRADE_KEYS) {
      const def = UPGRADES[key];
      const tier = state.tiers[key];
      const current = upgradeTier(key, tier);
      const next = tier < MAX_TIER ? def.tiers[tier + 1] : null;
      const afford = next && state.cash >= next.price;

      const row = h('div', { class: 'shop-row' },
        h('div', { class: 'shop-info' },
          h('span', { class: 'shop-label', text: def.label }),
          h('strong', { class: 'shop-tier', text: current.name }),
          h('span', { class: 'shop-blurb', text: `${current.value} ${def.unit} - ${def.blurb}` }),
        ),
        next
          ? h('button', {
            class: `btn btn-buy${afford ? '' : ' is-poor'}`,
            type: 'button',
            disabled: !afford,
            onclick: () => {
              if (buyUpgrade(state, key)) {
                onSpend('purchase');
                rebuild();
              } else {
                onSpend('deny');
              }
            },
          }, h('span', { text: next.name }), h('em', { text: money(next.price) }))
          : h('span', { class: 'shop-maxed', text: 'MAXED' }),
      );
      ship.append(row);
    }

    /* --- gear: consumables --- */
    const gear = panes.gear;
    gear.textContent = '';
    gear.append(cashTag);
    for (const item of ITEMS) {
      const owned = state.items[item.key];
      const afford = state.cash >= item.price && owned < item.max;
      gear.append(h('div', { class: 'shop-row' },
        h('div', { class: 'shop-info' },
          h('span', { class: 'shop-label', text: item.name }),
          h('strong', { class: 'shop-tier', text: `${owned} / ${item.max} carried` }),
          h('span', { class: 'shop-blurb', text: item.blurb }),
        ),
        h('button', {
          class: `btn btn-buy${afford ? '' : ' is-poor'}`,
          type: 'button',
          disabled: !afford,
          onclick: () => {
            if (buyItem(state, item.key)) {
              onSpend('purchase');
              rebuild();
            } else {
              onSpend('deny');
            }
          },
        }, h('span', { text: 'BUY' }), h('em', { text: money(item.price) })),
      ));
    }
    gear.append(h('p', { class: 'shop-note', text: 'Press 1-4 in the mine to use what you are carrying.' }));

    /* --- counter: refuel, repair, sell --- */
    const counter = panes.counter;
    counter.textContent = '';
    counter.append(cashTag);

    const fuelNeed = maxFuel(state) - state.ship.fuel;
    const hullNeed = maxHull(state) - state.ship.hull;
    const worth = cargoValue(state);

    counter.append(h('div', { class: 'shop-row' },
      h('div', { class: 'shop-info' },
        h('span', { class: 'shop-label', text: 'Refuel' }),
        h('strong', { class: 'shop-tier', text: `${fuelNeed.toFixed(1)} L needed` }),
        h('span', { class: 'shop-blurb', text: `${money(FUEL_PRICE)} per litre` }),
      ),
      h('button', {
        class: 'btn btn-buy',
        type: 'button',
        disabled: fuelNeed <= 0.01 || state.cash <= 0,
        onclick: () => {
          const spent = refuel(state);
          onSpend(spent > 0 ? 'purchase' : 'deny');
          rebuild();
        },
      }, h('span', { text: 'FILL TANK' }), h('em', { text: money(fuelNeed * FUEL_PRICE) })),
    ));

    counter.append(h('div', { class: 'shop-row' },
      h('div', { class: 'shop-info' },
        h('span', { class: 'shop-label', text: 'Repair' }),
        h('strong', { class: 'shop-tier', text: `${hullNeed.toFixed(0)} HP missing` }),
        h('span', { class: 'shop-blurb', text: `${money(REPAIR_PRICE)} per hull point` }),
      ),
      h('button', {
        class: 'btn btn-buy',
        type: 'button',
        disabled: hullNeed <= 0.01 || state.cash <= 0,
        onclick: () => {
          const spent = repair(state);
          onSpend(spent > 0 ? 'purchase' : 'deny');
          rebuild();
        },
      }, h('span', { text: 'REPAIR HULL' }), h('em', { text: money(hullNeed * REPAIR_PRICE) })),
    ));

    const entries = cargoManifest(state);
    counter.append(h('div', { class: 'shop-row is-sell' },
      h('div', { class: 'shop-info' },
        h('span', { class: 'shop-label', text: 'Sell the hold' }),
        h('strong', { class: 'shop-tier', text: worth > 0 ? money(worth) : 'nothing aboard' }),
        h('span', {
          class: 'shop-blurb',
          text: entries.length
            ? entries.map((e) => `${e.ore.name} x${e.n}`).join(', ')
            : 'Dig something up first.',
        }),
      ),
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        disabled: worth <= 0,
        onclick: () => {
          const paid = sellCargo(state);
          if (paid > 0) onSpend('sale', paid);
          rebuild();
        },
      }, h('span', { text: 'SELL ALL' }), h('em', { text: money(worth) })),
    ));

    // Stats, because a run is more interesting with a scoreboard.
    counter.append(h('div', { class: 'shop-stats' },
      h('span', {}, 'Trips ', h('strong', { text: String(state.stats.trips) })),
      h('span', {}, 'Tiles dug ', h('strong', { text: String(state.stats.dug) })),
      h('span', {}, 'Earned ', h('strong', { text: money(state.stats.earned) })),
      h('span', {}, 'Wrecks ', h('strong', { text: String(state.stats.deaths) })),
      h('span', {}, 'Drill ', h('strong', { text: `${drillPower(state)} ft/s` })),
    ));
  };

  rebuild();
  body.append(tabs, panes.ship, panes.gear, panes.counter);
  m.panel.append(body, h('div', { class: 'modal-actions' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'BACK TO THE MINE')));
  return m;
}

/* ------------------------------------------------------------------ */
/* The end                                                             */
/* ------------------------------------------------------------------ */

export function showEnd(root, state, { won, onRestart, onContinue }) {
  const m = modal(root, {
    title: won ? 'THE MOTHER LODE' : 'HULL BREACH',
    subtitle: won
      ? 'Mr. Natas was down there all along, and he was not happy to see you.'
      : 'The pod is gone. The upgrades are not.',
  });

  const last = state.deaths[state.deaths.length - 1];
  m.panel.append(
    h('div', { class: 'end-stats' },
      h('div', {}, h('span', { text: 'Deepest' }), h('strong', { text: `${Math.round(state.maxDepth).toLocaleString('en-US')} ft` })),
      h('div', {}, h('span', { text: 'Earned' }), h('strong', { text: money(state.stats.earned) })),
      h('div', {}, h('span', { text: 'Tiles dug' }), h('strong', { text: String(state.stats.dug) })),
      h('div', {}, h('span', { text: 'Trips home' }), h('strong', { text: String(state.stats.trips) })),
      h('div', {}, h('span', { text: 'Wrecks' }), h('strong', { text: String(state.stats.deaths) })),
    ),
    last && !won
      ? h('p', { class: 'end-cause', text: `Cause of loss: ${last.cause} at ${last.depth.toLocaleString('en-US')} ft.` })
      : null,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { m.close(); onContinue(); } }, 'KEEP DIGGING'),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { m.close(); onRestart(); } }, 'NEW MINE'),
    ),
  );
  return m;
}

export { h };
