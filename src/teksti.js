/**
 * The game's words.
 *
 * Money formatting, the RNOV branding, and the jokes. Keeping them together
 * means a translator - or someone adding a gag - has one file to open instead of
 * eleven, and it keeps the jokes out of the files that decide how the game
 * plays.
 *
 * Two rules this file follows.
 *
 * **Identifiers stay English.** `ironium`, `drill`, `fuel`, `out of fuel` are
 * save keys and lookup keys; the display strings next to them are Slovenian.
 * Translating a key would break every existing save and every test that names
 * one, and would buy nothing, because no player ever reads a key.
 *
 * **The jokes are all one joke.** RNOV is a state agency, so the mine is a
 * supply chain that comes with forms, a budget, a lunch break and a leave
 * policy. The player is a contractor who is never quite thanked.
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

/** The agency whose internal simulator this is. */
export const RNOV = {
  short: 'RNOV',
  full: 'Razvoj in nadzor oskrbovalne verige',
  product: 'DEEPCORE',
  tagline: 'Oskrbovalna veriga od izkopa do izplačila.',
  version: 'različica 4.2.1 - interno gradivo',
};

/**
 * Memos from head office, fired once each as the pod passes their depth.
 *
 * They are the running gag: the deeper and more dangerous the mine gets, the
 * more obviously the paperwork was written by someone who has never been down
 * there. Fired in order, so the joke escalates rather than arriving at random.
 */
export const MEMOS = [
  { at: 1000, text: 'RNOV dopis 4471: rudarjenje poteka po predpisih. Nadaljujte.' },
  { at: 2500, text: 'RNOV dopis 4472: obvestilo o lavi prejmete v tridesetih delovnih dneh.' },
  { at: 4000, text: 'RNOV dopis 4473: plin ni predviden v proračunu za letošnje leto.' },
  { at: 6000, text: 'RNOV dopis 4474: vročina je delovna obveznost. Hladilnik ni predviden.' },
  { at: 8000, text: 'RNOV dopis 4475: vaš dopust je prestavljen na nedoločen čas.' },
  { at: 10000, text: 'RNOV dopis 4476: prijavo poškodbe trupa oddajte na obrazcu R-9.' },
  { at: 12000, text: 'Na tej globini ni kremšnite. Samo Natas.' },
];

/**
 * Milestones by tiles dug, fired once each.
 *
 * Separate from the memos because they measure the player's effort rather than
 * their depth, and because "nobody moved this much rock even building the
 * highway" is a compliment that only lands once you have actually dug that much.
 */
export const MILESTONES = [
  { at: 250, text: 'Dvesto petdeset kvadratov. Lep tempo, pohvala bo zapisana v evidenco.' },
  { at: 500, text: 'Toliko kamna niso premaknili niti pri gradnji avtoceste.' },
  { at: 1000, text: 'Za tak rezultat bi vam priznali dodatek za delovno uspešnost. Ne bomo.' },
  { at: 2500, text: 'Vaša statistika je impresivna. Zapisali smo jo v evidenco. Evidence.' },
];

/**
 * A line for a notable find, keyed by ore id.
 *
 * Keyed by id and not chosen at random so the same ore always gets the same
 * line: a player who finds a second ruby should get the joke they remember, not
 * a reroll, and a test can assert on it.
 */
const FIND_QUIPS = {
  5: 'Platinovec. Fino, a to ne bo pokrilo dopusta.',
  6: 'Einsteinij. Fiziki bi bili veseli, računovodstvo ne.',
  7: 'Smaragd! Izpolnite obrazec R-7 in ga oddajte v osmih dneh.',
  8: 'Rubin! Tega ne damo v proračun, to gre v vitrino.',
  9: 'Diamant! Malica je danes na vas. (Se šalimo. Malice ni.)',
  10: 'Amazonit! Tega ne znajo oceniti niti na ministrstvu.',
};

/** The joke for a find, or null for ore that is not worth a joke. */
export const findQuip = (ore) => (ore && FIND_QUIPS[ore.id]) || null;

/**
 * How many entries of a threshold list have been passed at `value`.
 *
 * Both lists above are sorted and their thresholds only ever move one way, so
 * "how many have I passed" is enough to know which ones still owe the player a
 * message - no set of fired ids to keep, and nothing to serialise.
 */
export const reachedCount = (list, value) => list.filter((entry) => entry.at <= value).length;