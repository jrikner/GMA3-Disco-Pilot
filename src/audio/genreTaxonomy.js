export const APP_GENRES = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']

const LATIN_KEYWORDS = [
  'latin', 'salsa', 'flamenco', 'cumbia', 'samba', 'bossa', 'bachata', 'bolero', 'tango', 'tejano',
  'merengue', 'reggaeton', 'mambo', 'ranchera', 'norteno', 'norte o', 'forro', 'mpb', 'axe', 'pagode',
  'sertanejo', 'guaracha', 'batucada', 'cha cha', 'son', 'rumba', 'beguine', 'bossanova', 'bossa nova',
]

const HIPHOP_KEYWORDS = [
  'hip hop', 'rap', 'rnb', 'rhythm and blues', 'soul', 'funk', 'p funk', 'boom bap', 'gangsta', 'trap',
  'g funk', 'new jack swing', 'neo soul', 'contemporary r and b', 'go go', 'miami bass', 'turntablism',
]

const EIGHTIES_KEYWORDS = [
  'synth pop', 'new wave', 'italo disco', 'hi nrg', 'euro disco', 'new romantic', 'city pop', 'darkwave',
  'coldwave', 'italo house', 'synthwave', 'electroclash',
]

const TECHNO_KEYWORDS = [
  'techno', 'acid', 'gabber', 'hardcore', 'schranz', 'ebm', 'industrial', 'minimal techno', 'hard techno',
  'detroit techno', 'hardstyle', 'speedcore', 'happy hardcore', 'power electronics', 'power noise',
  'rhythmic noise', 'new beat', 'minimal',
]

const EDM_KEYWORDS = [
  'house', 'trance', 'drum and bass', 'jungle', 'dubstep', 'garage', 'electro', 'breakbeat', 'big beat',
  'grime', 'uk funky', 'idm', 'leftfield', 'ambient', 'downtempo', 'trip hop', 'dub', 'goa trance',
  'psy trance', 'progressive trance', 'progressive house', 'deep house', 'future house', 'future bass',
  'eurodance', 'euro house', 'italodance', 'tech house', 'microhouse', 'breaks', 'uk garage',
]

const ROCK_KEYWORDS = [
  'rock', 'metal', 'punk', 'grunge', 'hard rock', 'indie rock', 'alternative rock', 'blues', 'rock and roll',
  'psychobilly', 'shoegaze', 'emo', 'goth rock', 'garage rock', 'southern rock', 'arena rock', 'prog rock',
  'rockabilly', 'folk rock', 'death metal', 'black metal', 'thrash', 'hardcore',
]

const POP_KEYWORDS = [
  'pop', 'ballad', 'schlager', 'vocal', 'reggae', 'dancehall', 'disco', 'europop', 'k pop', 'j pop',
  'kayokyoku', 'chanson', 'theme', 'bubblegum', 'teen pop', 'karaoke',
]

const CORPORATE_PARENTS = new Set([
  'brass and military',
  'children s',
  'classical',
  'folk world and country',
  'jazz',
  'non music',
  'stage and screen',
])

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function hasKeyword(haystack, keywords) {
  return keywords.some((keyword) => haystack.includes(keyword))
}

export function parseDiscogsLabel(label) {
  const raw = String(label || '')
  const parts = raw.split('---')
  const parent = parts[0] || raw
  const style = parts[1] || ''

  return {
    raw,
    parent,
    style,
    normalizedParent: normalizeToken(parent),
    normalizedStyle: normalizeToken(style),
    normalizedLabel: normalizeToken(raw.replace(/---/g, ' ')),
  }
}

export function mapDiscogsLabelToGenre(label) {
  const parsed = typeof label === 'string' ? parseDiscogsLabel(label) : label
  const joined = `${parsed.normalizedParent} ${parsed.normalizedStyle}`.trim()

  if (parsed.normalizedParent === 'latin' || hasKeyword(joined, LATIN_KEYWORDS)) return 'latin'
  if (parsed.normalizedParent === 'hip hop' || parsed.normalizedParent === 'funk soul' || hasKeyword(joined, HIPHOP_KEYWORDS)) return 'hiphop'
  if (hasKeyword(joined, EIGHTIES_KEYWORDS)) return 'eighties'
  if (hasKeyword(joined, TECHNO_KEYWORDS)) return 'techno'
  if (parsed.normalizedParent === 'electronic' || hasKeyword(joined, EDM_KEYWORDS)) return 'edm'
  if (parsed.normalizedParent === 'rock' || hasKeyword(joined, ROCK_KEYWORDS)) return 'rock'
  if (parsed.normalizedParent === 'pop' || parsed.normalizedParent === 'reggae' || hasKeyword(joined, POP_KEYWORDS)) return 'pop'
  if (CORPORATE_PARENTS.has(parsed.normalizedParent)) return 'corporate'

  return 'corporate'
}

export function buildGenreScoreMap() {
  return Object.fromEntries(APP_GENRES.map((genre) => [genre, 0]))
}
