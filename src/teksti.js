/**
 * The game's words.
 *
 * Money formatting and the flavour lines. Keeping them together means someone
 * adding a gag has one file to open instead of eleven, and it keeps the jokes
 * out of the files that decide how the game plays.
 *
 * **Identifiers stay English.** `ironium`, `drill`, `fuel`, `out of fuel` are
 * save keys and lookup keys; the display strings next to them are Slovenian.
 * Translating a key would break every existing save and every test that names
 * one, and would buy nothing, because no player ever reads a key.
 */

/**
 * A whole number with a dot for the thousands separator, which is how Slovenian
 * groups digits.
 *
 * Hand-rolled rather than `toLocaleString('sl-SI')` on purpose. The browser and
 * Node do not always agree on locale data, the tests assert on this exact
 * string, and one regex is cheaper than being surprised by a build machine.
 */
export const grouped = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Money, in euros, with a space before the sign. */
export const money = (n) => `${grouped(n)} €`;

/**
 * A line for a notable find, keyed by ore id.
 *
 * Keyed by id and not chosen at random so the same ore always gets the same
 * line: a player who finds a second ruby should get the joke they remember, not
 * a reroll, and a test can assert on it.
 */
const FIND_QUIPS = {
  5: 'Platinovec. Vreden več kot vse, kar si izkopal doslej.',
  6: 'Einsteinij! Rudnik tega ni videl od leta 1974.',
  7: 'Smaragd! Zelen kot pomlad v dolini.',
  8: 'Rubin! Barva je prava in cena tudi.',
  9: 'Diamant! Zdaj ne vidiš več ničesar drugega.',
  10: 'Amazonit! Tega ne znajo oceniti niti na ministrstvu.',
};

/** The joke for a find, or null for ore that is not worth a joke. */
export const findQuip = (ore) => (ore && FIND_QUIPS[ore.id]) || null;