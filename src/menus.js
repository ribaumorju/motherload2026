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
import { money, grouped } from './teksti.js';

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
    h('p', { class: 'title-tag', text: 'Rudnik gre 12.800 čevljev navzdol. Nazaj ne gre.' }),
    h('div', { class: 'title-actions' },
      hasSave
        ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { remove(); onContinue(); } }, 'NADALJUJ')
        : null,
      h('button', {
        class: hasSave ? 'btn' : 'btn btn-primary',
        type: 'button',
        onclick: () => { remove(); onStart(); },
      }, hasSave ? 'NOV RUDNIK' : 'ZAČNI VRTATI'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: onHelp }, 'NAVODILA'),
    ),
    h('p', { class: 'title-foot', text: 'Različica 1.0. Rudnik ne odpušča napak.' }),
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
    ['Premik', 'Puščice ali WASD'],
    ['Vrtanje', 'Zapelji se v kamen - sveder reže v smer, v katero gledaš'],
    ['Vrtaj dol', 'Drži preslednico (ali Shift / J) za vrtanje naravnost navzdol'],
    ['Pristanek', 'Ustavi se pod stavbo in pritisni E'],
    ['Premor', 'Esc'],
    ['Zvok', 'M'],
    ['Telefon', 'Leva polovica zaslona je palica, desna vrta'],
  ];
  const table = h('div', { class: 'help-grid' },
    rows.flatMap(([k, v]) => [
      h('span', { class: 'help-key', text: k }),
      h('span', { class: 'help-val', text: v }),
    ]));

  const goals = h('ul', { class: 'help-list' },
    h('li', { text: 'Koplji rudo. Tovor se meri v kilogramih, ne v kvadratih - težka poceni ruda ga napolni hitro.' }),
    h('li', { text: 'Prodaj na odkupu rude. Gorivo in popravila dobiš na črpalki in v servisu.' }),
    h('li', { text: 'Zelene žile so plin. Videti so kot kamen, dokler se jih sveder ne dotakne. Bolijo.' }),
    h('li', { text: 'Oranžni bazeni so lava. Sveder je ne reže, zato pojdi okoli - ali si pot naredi z eksplozivom.' }),
    h('li', { text: 'Vrtati znaš tudi navzgor. Počasneje in dražje je od letenja, a to je izhod, če padeš v votlino.' }),
    h('li', { text: 'Če zmanjka goriva ali razbiješ trup, izgubiš tovor, nikoli nadgradenj.' }),
    h('li', { text: 'Na dnu rudnika je nekaj. Čaka že dolgo.' }),
  );

  const m = modal(root, { title: 'Navodila', subtitle: 'Dve dejanji: leti in vrta. Vse ostalo so posledice.' });
  m.panel.append(table, h('h3', { class: 'help-head', text: 'Kako se igra' }), goals,
    h('div', { class: 'modal-actions' },
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => { m.close(); if (onClose) onClose(); },
      }, 'RAZUMEM')));
  return m;
}

/* ------------------------------------------------------------------ */
/* Pause                                                               */
/* ------------------------------------------------------------------ */

export function showPause(root, { onResume, onSave, onQuit, muted, onToggleSound }) {
  const m = modal(root, { title: 'Premor', subtitle: 'Rudnik ne bo šel nikamor.', onClose: onResume });
  m.panel.append(h('div', { class: 'modal-actions column' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'NAPREJ'),
    h('button', { class: 'btn', type: 'button', onclick: () => { onSave(); } }, 'SHRANI ZDAJ'),
    h('button', {
      class: 'btn',
      type: 'button',
      onclick: (event) => {
        onToggleSound();
        event.currentTarget.textContent = muted ? 'ZVOK: IZKLOPLJEN' : 'ZVOK: VKLOPLJEN';
      },
    }, muted ? 'ZVOK: IZKLOPLJEN' : 'ZVOK: VKLOPLJEN'),
    h('button', {
      class: 'btn btn-danger',
      type: 'button',
      onclick: () => { m.close(); onQuit(); },
    }, 'NA ZAČETEK'),
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
    title: 'Servis in trgovina',
    subtitle: 'Kupi naslednjo stopnjo. Vse je trajno.',
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
      h('span', { text: 'PRORAČUN' }), h('strong', { text: money(state.cash) }));

    tabs.textContent = '';
    for (const [key, label] of [['ship', 'PLOVILO'], ['gear', 'ZALOGE'], ['counter', 'BLAGAJNA']]) {
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
          : h('span', { class: 'shop-maxed', text: 'NAJVEČ' }),
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
          h('strong', { class: 'shop-tier', text: `${owned} / ${item.max} v tovoru` }),
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
        }, h('span', { text: 'KUPI' }), h('em', { text: money(item.price) })),
      ));
    }
    gear.append(h('p', { class: 'shop-note', text: 'V rudniku pritisni 1-6 za uporabo tega, kar nosiš.' }));

    /* --- counter: refuel, repair, sell --- */
    const counter = panes.counter;
    counter.textContent = '';
    counter.append(cashTag);

    const fuelNeed = maxFuel(state) - state.ship.fuel;
    const hullNeed = maxHull(state) - state.ship.hull;
    const worth = cargoValue(state);

    counter.append(h('div', { class: 'shop-row' },
      h('div', { class: 'shop-info' },
        h('span', { class: 'shop-label', text: 'Gorivo' }),
        h('strong', { class: 'shop-tier', text: `${fuelNeed.toFixed(1)} L potrebnih` }),
        h('span', { class: 'shop-blurb', text: `${money(FUEL_PRICE)} na liter` }),
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
      }, h('span', { text: 'NATOČI' }), h('em', { text: money(fuelNeed * FUEL_PRICE) })),
    ));

    counter.append(h('div', { class: 'shop-row' },
      h('div', { class: 'shop-info' },
        h('span', { class: 'shop-label', text: 'Popravilo' }),
        h('strong', { class: 'shop-tier', text: `${hullNeed.toFixed(0)} HP manjka` }),
        h('span', { class: 'shop-blurb', text: `${money(REPAIR_PRICE)} na točko trupa` }),
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
      }, h('span', { text: 'POPRAVI TRUP' }), h('em', { text: money(hullNeed * REPAIR_PRICE) })),
    ));

    const entries = cargoManifest(state);
    counter.append(h('div', { class: 'shop-row is-sell' },
      h('div', { class: 'shop-info' },
        h('span', { class: 'shop-label', text: 'Prodaj tovor' }),
        h('strong', { class: 'shop-tier', text: worth > 0 ? money(worth) : 'nič na krovu' }),
        h('span', {
          class: 'shop-blurb',
          text: entries.length
            ? entries.map((e) => `${e.ore.name} x${e.n}`).join(', ')
            : 'Najprej kaj izkoplji.',
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
      }, h('span', { text: 'PRODAJ VSE' }), h('em', { text: money(worth) })),
    ));

    // Stats, because a run is more interesting with a scoreboard.
    counter.append(h('div', { class: 'shop-stats' },
      h('span', {}, 'Voženj ', h('strong', { text: String(state.stats.trips) })),
      h('span', {}, 'Izkopanih ', h('strong', { text: String(state.stats.dug) })),
      h('span', {}, 'Zasluženo ', h('strong', { text: money(state.stats.earned) })),
      h('span', {}, 'Razbitih ', h('strong', { text: String(state.stats.deaths) })),
      h('span', {}, 'Sveder ', h('strong', { text: `${drillPower(state)} ft/s` })),
    ));
  };

  rebuild();
  body.append(tabs, panes.ship, panes.gear, panes.counter);
  m.panel.append(body, h('div', { class: 'modal-actions' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'NAZAJ V RUDNIK')));
  return m;
}

/* ------------------------------------------------------------------ */
/* The end                                                             */
/* ------------------------------------------------------------------ */

export function showEnd(root, state, { won, onRestart, onContinue }) {
  const m = modal(root, {
    title: won ? 'MATIČNA ŽILA' : 'TRUP JE POPUSTIL',
    subtitle: won
      ? 'Gospod Natas je bil tam vse od začetka in ni bil vesel, da ste ga našli. Ponudil vam je službo.'
      : 'Plovila ni več. Nadgradnje so ostale.',
  });

  const last = state.deaths[state.deaths.length - 1];
  m.panel.append(
    h('div', { class: 'end-stats' },
      h('div', {}, h('span', { text: 'Najgloblje' }), h('strong', { text: `${grouped(state.maxDepth)} ft` })),
      h('div', {}, h('span', { text: 'Zasluženo' }), h('strong', { text: money(state.stats.earned) })),
      h('div', {}, h('span', { text: 'Izkopanih' }), h('strong', { text: String(state.stats.dug) })),
      h('div', {}, h('span', { text: 'Voženj domov' }), h('strong', { text: String(state.stats.trips) })),
      h('div', {}, h('span', { text: 'Razbitih plovil' }), h('strong', { text: String(state.stats.deaths) })),
    ),
    last && !won
      ? h('p', { class: 'end-cause', text: `Vzrok izgube: ${last.cause} na ${grouped(last.depth)} ft.` })
      : null,
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { m.close(); onContinue(); } }, 'KOPLJI NAPREJ'),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { m.close(); onRestart(); } }, 'NOV RUDNIK'),
    ),
  );
  return m;
}

export { h };
