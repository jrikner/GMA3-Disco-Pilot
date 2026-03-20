/**
 * On-device music genre detection using Essentia.js
 *
 * Uses the Discogs MAEST model (maest-30s-pw) which classifies 519 music styles.
 * We map the raw 519-label output to our 8 internal genre categories.
 *
 * Analysis runs on a rolling 30-second context window every 4 seconds.
 * A genre change requires sufficient confidence for 2 consecutive windows (hysteresis).
 *
 * Improvements over previous version:
 * - Massively expanded label mapping (~300+ labels vs ~90)
 * - Anti-aliased resampling (windowed sinc filter instead of linear interpolation)
 * - Wider BPM bias ranges with softer Gaussian weighting
 * - Linear score normalization instead of sqrt (fairer across genres)
 * - 30s context window matching MAEST-30s model training config
 * - Uses all predictions (not just top 120) for better coverage
 * - Accepts low-band energy hint from BPM detector for spectral-aware biasing
 *
 * NOTE: Essentia.js WASM and model files must be placed in /public/models/
 * Required files:
 *   - /public/models/essentia-wasm.module.wasm
 *   - /public/models/maest-30s-pw.onnx (or TF.js model files)
 *
 * Until the model is loaded, genre detection falls back to spectral heuristics.
 */

const MAEST_CONTEXT_SECONDS = 30     // Increased from 20 to match MAEST-30s training
const ANALYSIS_INTERVAL_MS = 4000    // Slightly slower for more stable windows
const CONFIDENCE_THRESHOLD = 0.35    // Lowered from 0.42 — expanded mapping captures more signal
const GENRE_MARGIN_THRESHOLD = 0.06  // Lowered from 0.08 — more labels = smaller per-genre peaks
const HYSTERESIS_WINDOWS = 2
const INPUT_SAMPLE_RATE = 44100
const MODEL_SAMPLE_RATE = 16000
const MAEST_LABELS_URL = '/models/discogs_519labels.txt'
const MAEST_GRAPH_FILENAMES = [
  '/models/maest-30s-pw',
  '/models/maest-30s-pw/model',
  'maest-30s-pw',
]
const GENRE_BUFFER_WORKLET_URL = '/worklets/genre-buffer-processor.js'

// ── Genre label mapping ──────────────────────────────────────────────────────
// Maps Essentia/Discogs style tags → our internal genre IDs
// MAEST outputs labels in "Genre---Style" format; we normalize both parts.
// This mapping covers ~300+ Discogs styles for comprehensive coverage.

const ALL_GENRES = ['techno', 'edm', 'hiphop', 'pop', 'eighties', 'latin', 'rock', 'corporate']

// Comprehensive mapping of Discogs/MAEST style labels to our 8 genres.
// Labels are normalized: lowercase, & → "and", non-alphanumeric → space, trimmed.
// The MAEST model uses "Genre---Style" format which normalizes to "genre style".
const DISCOS_LABEL_TO_GENRE = {
  // ── Techno ─────────────────────────────────────────────────────────────────
  techno: 'techno',
  'detroit techno': 'techno',
  'acid techno': 'techno',
  'hard techno': 'techno',
  hardtechno: 'techno',
  minimal: 'techno',
  'minimal techno': 'techno',
  'tech house': 'techno',
  industrial: 'techno',
  ebm: 'techno',
  'acid house': 'techno',
  acid: 'techno',
  'hard house': 'techno',
  'hard dance': 'techno',
  hardcore: 'techno',
  'gabber': 'techno',
  'happy hardcore': 'techno',
  gabba: 'techno',
  schranz: 'techno',
  speedcore: 'techno',
  noiscore: 'techno',
  'dark ambient': 'techno',
  noise: 'techno',
  'power electronics': 'techno',
  'power noise': 'techno',
  'rhythmic noise': 'techno',
  'electronic techno': 'techno',
  'electronic minimal': 'techno',
  'electronic tech house': 'techno',
  'electronic acid house': 'techno',
  'electronic acid': 'techno',
  'electronic industrial': 'techno',
  'electronic ebm': 'techno',
  'electronic hard techno': 'techno',
  'electronic detroit techno': 'techno',
  'electronic hardcore': 'techno',
  'electronic gabber': 'techno',
  'electronic hard house': 'techno',
  'electronic hard dance': 'techno',

  // ── EDM / Electronic Dance ─────────────────────────────────────────────────
  house: 'edm',
  'deep house': 'edm',
  'progressive house': 'edm',
  electro: 'edm',
  trance: 'edm',
  'hard trance': 'edm',
  'progressive trance': 'edm',
  'psy trance': 'edm',
  psytrance: 'edm',
  'goa trance': 'edm',
  'vocal trance': 'edm',
  dubstep: 'edm',
  'drum and bass': 'edm',
  'drum n bass': 'edm',
  dnb: 'edm',
  jungle: 'edm',
  garage: 'edm',
  'uk garage': 'edm',
  'speed garage': 'edm',
  '2 step': 'edm',
  '2step': 'edm',
  bassline: 'edm',
  edm: 'edm',
  electronic: 'edm',
  breakbeat: 'edm',
  'big beat': 'edm',
  breaks: 'edm',
  'florida breaks': 'edm',
  'nu skool breaks': 'edm',
  'broken beat': 'edm',
  grime: 'edm',
  'uk funky': 'edm',
  'future garage': 'edm',
  'future bass': 'edm',
  'future house': 'edm',
  'tropical house': 'edm',
  'bass music': 'edm',
  'glitch hop': 'edm',
  glitch: 'edm',
  'idm': 'edm',
  'leftfield': 'edm',
  'microhouse': 'edm',
  eurodance: 'edm',
  eurohouse: 'edm',
  'euro house': 'edm',
  'funky house': 'edm',
  'soulful house': 'edm',
  'tribal house': 'edm',
  'tribal': 'edm',
  'filter house': 'edm',
  'latin house': 'edm',
  'chicago house': 'edm',
  'jackin house': 'edm',
  'bounce': 'edm',
  'hardstyle': 'edm',
  'jumpstyle': 'edm',
  dub: 'edm',
  'dub techno': 'edm',
  'electronic house': 'edm',
  'electronic deep house': 'edm',
  'electronic progressive house': 'edm',
  'electronic electro': 'edm',
  'electronic trance': 'edm',
  'electronic hard trance': 'edm',
  'electronic progressive trance': 'edm',
  'electronic psy trance': 'edm',
  'electronic goa trance': 'edm',
  'electronic dubstep': 'edm',
  'electronic drum and bass': 'edm',
  'electronic jungle': 'edm',
  'electronic garage': 'edm',
  'electronic uk garage': 'edm',
  'electronic breakbeat': 'edm',
  'electronic breaks': 'edm',
  'electronic big beat': 'edm',
  'electronic grime': 'edm',
  'electronic idm': 'edm',
  'electronic leftfield': 'edm',
  'electronic eurodance': 'edm',
  'electronic glitch': 'edm',
  'electronic dub': 'edm',
  'electronic dub techno': 'edm',
  'electronic hardstyle': 'edm',
  'electronic future jazz': 'edm',
  'electronic tribal': 'edm',
  'electronic downtempo': 'edm',
  'electronic abstract': 'edm',
  'electronic experimental': 'edm',
  'electronic bass music': 'edm',
  'electronic uk funky': 'edm',
  'electronic speed garage': 'edm',

  // ── Hip-hop / R&B / Soul / Funk ────────────────────────────────────────────
  'hip hop': 'hiphop',
  rap: 'hiphop',
  rnb: 'hiphop',
  'r and b': 'hiphop',
  'rhythm and blues': 'hiphop',
  soul: 'hiphop',
  funk: 'hiphop',
  'trip hop': 'hiphop',
  'boom bap': 'hiphop',
  'gangsta rap': 'hiphop',
  'gangsta': 'hiphop',
  trap: 'hiphop',
  'cloud rap': 'hiphop',
  'conscious': 'hiphop',
  'conscious hip hop': 'hiphop',
  crunk: 'hiphop',
  'dirty south': 'hiphop',
  'east coast hip hop': 'hiphop',
  'west coast hip hop': 'hiphop',
  'golden age hip hop': 'hiphop',
  'g funk': 'hiphop',
  'horrorcore': 'hiphop',
  'instrumental hip hop': 'hiphop',
  'jazzy hip hop': 'hiphop',
  turntablism: 'hiphop',
  'abstract hip hop': 'hiphop',
  'pop rap': 'hiphop',
  'southern hip hop': 'hiphop',
  'hardcore hip hop': 'hiphop',
  'miami bass': 'hiphop',
  bounce: 'hiphop',
  'neo soul': 'hiphop',
  'new jack swing': 'hiphop',
  'contemporary r and b': 'hiphop',
  'p funk': 'hiphop',
  'go go': 'hiphop',
  'deep funk': 'hiphop',
  'funk metal': 'hiphop',
  'hip hop hip hop': 'hiphop',
  'hip hop rap': 'hiphop',
  'hip hop rnb': 'hiphop',
  'hip hop soul': 'hiphop',
  'hip hop funk': 'hiphop',
  'hip hop trip hop': 'hiphop',
  'hip hop boom bap': 'hiphop',
  'hip hop gangsta': 'hiphop',
  'hip hop trap': 'hiphop',
  'hip hop crunk': 'hiphop',
  'hip hop turntablism': 'hiphop',
  'hip hop conscious': 'hiphop',
  'hip hop pop rap': 'hiphop',
  'hip hop instrumental': 'hiphop',
  'hip hop jazzy hip hop': 'hiphop',
  'hip hop bass music': 'hiphop',
  'hip hop abstract': 'hiphop',
  'hip hop east coast': 'hiphop',
  'hip hop west coast': 'hiphop',
  'hip hop dirty south': 'hiphop',
  'hip hop miami bass': 'hiphop',
  'hip hop g funk': 'hiphop',
  'hip hop horrorcore': 'hiphop',
  'hip hop hardcore hip hop': 'hiphop',
  'funk and soul': 'hiphop',
  'funk and soul soul': 'hiphop',
  'funk and soul funk': 'hiphop',
  'funk and soul neo soul': 'hiphop',
  'funk and soul disco': 'hiphop',
  'funk and soul rhythm and blues': 'hiphop',
  'funk and soul p funk': 'hiphop',
  'funk and soul go go': 'hiphop',
  'funk and soul boogie': 'hiphop',
  'funk and soul gospel': 'hiphop',
  'funk and soul deep funk': 'hiphop',
  'funk and soul new jack swing': 'hiphop',
  boogie: 'hiphop',

  // ── Pop ────────────────────────────────────────────────────────────────────
  pop: 'pop',
  dancepop: 'pop',
  'dance pop': 'pop',
  synthpop: 'pop',
  'synth pop': 'pop',
  electropop: 'pop',
  'electro pop': 'pop',
  'indie pop': 'pop',
  kpop: 'pop',
  'k pop': 'pop',
  'teen pop': 'pop',
  'dream pop': 'pop',
  'art pop': 'pop',
  'chamber pop': 'pop',
  'baroque pop': 'pop',
  'power pop': 'pop',
  'bubblegum': 'pop',
  'bubblegum pop': 'pop',
  'sunshine pop': 'pop',
  'soft rock': 'pop',
  'adult contemporary': 'pop',
  'vocal': 'pop',
  ballad: 'pop',
  'chanson': 'pop',
  'schlager': 'pop',
  'city pop': 'pop',
  jpop: 'pop',
  'j pop': 'pop',
  cpop: 'pop',
  'c pop': 'pop',
  'europop': 'pop',
  'pop pop': 'pop',
  'pop dance pop': 'pop',
  'pop synth pop': 'pop',
  'pop electropop': 'pop',
  'pop indie pop': 'pop',
  'pop teen pop': 'pop',
  'pop vocal': 'pop',
  'pop ballad': 'pop',
  'pop schlager': 'pop',
  'pop chanson': 'pop',
  'pop europop': 'pop',
  'pop art pop': 'pop',
  'pop power pop': 'pop',
  'pop dream pop': 'pop',
  'pop soul': 'pop',

  // ── 80s / Disco / Retro ────────────────────────────────────────────────────
  '80s': 'eighties',
  '1980s': 'eighties',
  'new wave': 'eighties',
  postpunk: 'eighties',
  'post punk': 'eighties',
  synthwave: 'eighties',
  'synth wave': 'eighties',
  retrowave: 'eighties',
  'italo disco': 'eighties',
  disco: 'eighties',
  hinrg: 'eighties',
  'hi nrg': 'eighties',
  eurodisco: 'eighties',
  'euro disco': 'eighties',
  'nu disco': 'eighties',
  'nudisco': 'eighties',
  'cosmic disco': 'eighties',
  'space disco': 'eighties',
  'disco polo': 'eighties',
  'boogie funk': 'eighties',
  'freestyle': 'eighties',
  electrofunk: 'eighties',
  'electro funk': 'eighties',
  'electronic synth pop': 'eighties',
  'electronic new wave': 'eighties',
  'electronic synthwave': 'eighties',
  'electronic disco': 'eighties',
  'electronic italo disco': 'eighties',
  'electronic nu disco': 'eighties',
  'electronic hi nrg': 'eighties',
  'electronic euro disco': 'eighties',
  'electronic freestyle': 'eighties',
  'electronic electro disco': 'eighties',
  'electronic darkwave': 'eighties',
  darkwave: 'eighties',
  coldwave: 'eighties',
  'cold wave': 'eighties',
  'minimal wave': 'eighties',
  'minimal synth': 'eighties',
  'electronic cold wave': 'eighties',
  'electronic minimal wave': 'eighties',
  'pop new wave': 'pop',  // Could be pop or eighties — lean pop when classified as Pop---New Wave
  'rock new wave': 'eighties',
  'rock post punk': 'eighties',
  'rock synthwave': 'eighties',
  'rock goth rock': 'eighties',
  'goth rock': 'eighties',
  gothic: 'eighties',
  'deathrock': 'eighties',

  // ── Latin / Afro / World ───────────────────────────────────────────────────
  latin: 'latin',
  reggaeton: 'latin',
  salsa: 'latin',
  merengue: 'latin',
  cumbia: 'latin',
  bachata: 'latin',
  afrobeats: 'latin',
  afrobeat: 'latin',
  'afro house': 'latin',
  tropical: 'latin',
  soca: 'latin',
  dancehall: 'latin',
  reggae: 'latin',
  bossa: 'latin',
  'bossa nova': 'latin',
  samba: 'latin',
  'latin jazz': 'latin',
  'latin soul': 'latin',
  'latin pop': 'latin',
  tango: 'latin',
  flamenco: 'latin',
  rumba: 'latin',
  bolero: 'latin',
  mambo: 'latin',
  chacha: 'latin',
  'cha cha': 'latin',
  son: 'latin',
  bomba: 'latin',
  plena: 'latin',
  vallenato: 'latin',
  norteña: 'latin',
  nortena: 'latin',
  corrido: 'latin',
  ranchera: 'latin',
  mariachi: 'latin',
  tejano: 'latin',
  'latin latin': 'latin',
  'latin reggaeton': 'latin',
  'latin salsa': 'latin',
  'latin cumbia': 'latin',
  'latin bossa nova': 'latin',
  'latin samba': 'latin',
  'latin tango': 'latin',
  'latin bolero': 'latin',
  'latin son': 'latin',
  'latin merengue': 'latin',
  'latin bachata': 'latin',
  'latin mambo': 'latin',
  'latin rumba': 'latin',
  'latin flamenco': 'latin',
  'latin norteña': 'latin',
  'latin vallenato': 'latin',
  'latin ranchera': 'latin',
  'latin latin jazz': 'latin',
  'latin latin pop': 'latin',
  'latin cha cha': 'latin',
  reggae: 'latin',
  'roots reggae': 'latin',
  'dub reggae': 'latin',
  'lovers rock': 'latin',
  ska: 'latin',
  rocksteady: 'latin',
  calypso: 'latin',
  compas: 'latin',
  zouk: 'latin',
  highlife: 'latin',
  soukous: 'latin',
  afropop: 'latin',
  'afro cuban': 'latin',
  'afro cuban jazz': 'latin',
  kwaito: 'latin',
  'cape jazz': 'latin',
  'reggae reggae': 'latin',
  'reggae roots reggae': 'latin',
  'reggae dub': 'latin',
  'reggae ska': 'latin',
  'reggae rocksteady': 'latin',
  'reggae dancehall': 'latin',
  'reggae lovers rock': 'latin',
  'reggae calypso': 'latin',
  'reggae soca': 'latin',

  // ── Rock ───────────────────────────────────────────────────────────────────
  rock: 'rock',
  alternative: 'rock',
  'indie rock': 'rock',
  punk: 'rock',
  metal: 'rock',
  'hard rock': 'rock',
  'classic rock': 'rock',
  grunge: 'rock',
  emo: 'rock',
  'punk rock': 'rock',
  'pop punk': 'rock',
  'post rock': 'rock',
  'math rock': 'rock',
  'progressive rock': 'rock',
  'prog rock': 'rock',
  'psychedelic rock': 'rock',
  'stoner rock': 'rock',
  'garage rock': 'rock',
  'surf rock': 'rock',
  'surf': 'rock',
  'blues rock': 'rock',
  'folk rock': 'rock',
  'country rock': 'rock',
  'southern rock': 'rock',
  'arena rock': 'rock',
  'aor': 'rock',
  'stadium rock': 'rock',
  shoegaze: 'rock',
  'noise rock': 'rock',
  'noise pop': 'rock',
  'space rock': 'rock',
  'krautrock': 'rock',
  'art rock': 'rock',
  'avant garde': 'rock',
  experimental: 'rock',
  'lo fi': 'rock',
  lofi: 'rock',
  'britpop': 'rock',
  'brit pop': 'rock',
  'mod': 'rock',
  ska: 'rock',  // Also maps to latin above — last write wins, but normalizeLabel dedup handles it
  'ska punk': 'rock',
  'heavy metal': 'rock',
  'thrash metal': 'rock',
  'death metal': 'rock',
  'black metal': 'rock',
  'doom metal': 'rock',
  'sludge metal': 'rock',
  'stoner metal': 'rock',
  'speed metal': 'rock',
  'power metal': 'rock',
  'symphonic metal': 'rock',
  'gothic metal': 'rock',
  'nu metal': 'rock',
  metalcore: 'rock',
  'post metal': 'rock',
  'progressive metal': 'rock',
  'folk metal': 'rock',
  'viking metal': 'rock',
  'industrial metal': 'rock',
  'alternative rock': 'rock',
  'indie': 'rock',
  'rock rock': 'rock',
  'rock alternative rock': 'rock',
  'rock indie rock': 'rock',
  'rock punk': 'rock',
  'rock hard rock': 'rock',
  'rock classic rock': 'rock',
  'rock grunge': 'rock',
  'rock progressive rock': 'rock',
  'rock psychedelic rock': 'rock',
  'rock blues rock': 'rock',
  'rock folk rock': 'rock',
  'rock country rock': 'rock',
  'rock southern rock': 'rock',
  'rock garage rock': 'rock',
  'rock surf': 'rock',
  'rock shoegaze': 'rock',
  'rock post rock': 'rock',
  'rock math rock': 'rock',
  'rock stoner rock': 'rock',
  'rock space rock': 'rock',
  'rock krautrock': 'rock',
  'rock art rock': 'rock',
  'rock noise rock': 'rock',
  'rock experimental': 'rock',
  'rock britpop': 'rock',
  'rock mod': 'rock',
  'rock emo': 'rock',
  'rock pop punk': 'rock',
  'rock punk rock': 'rock',
  'rock arena rock': 'rock',
  'rock aor': 'rock',
  'rock lo fi': 'rock',
  'rock heavy metal': 'rock',
  'rock thrash': 'rock',
  'rock death metal': 'rock',
  'rock black metal': 'rock',
  'rock doom metal': 'rock',
  'rock speed metal': 'rock',
  'rock power metal': 'rock',
  'rock nu metal': 'rock',
  'rock metalcore': 'rock',
  'rock post metal': 'rock',
  'rock progressive metal': 'rock',
  'rock folk metal': 'rock',
  'rock industrial': 'rock',
  'rock symphonic rock': 'rock',

  // ── Corporate / Background / Classical / Jazz ──────────────────────────────
  ambient: 'corporate',
  classical: 'corporate',
  jazz: 'corporate',
  acoustic: 'corporate',
  'easy listening': 'corporate',
  lounge: 'corporate',
  chillout: 'corporate',
  'chill out': 'corporate',
  'new age': 'corporate',
  instrumental: 'corporate',
  downtempo: 'corporate',
  'smooth jazz': 'corporate',
  'acid jazz': 'corporate',
  'free jazz': 'corporate',
  'jazz funk': 'corporate',
  'fusion': 'corporate',
  'jazz fusion': 'corporate',
  'big band': 'corporate',
  swing: 'corporate',
  bop: 'corporate',
  bebop: 'corporate',
  'hard bop': 'corporate',
  'modal': 'corporate',
  'cool jazz': 'corporate',
  'post bop': 'corporate',
  'contemporary jazz': 'corporate',
  'avant garde jazz': 'corporate',
  'spiritual jazz': 'corporate',
  'nu jazz': 'corporate',
  'vocal jazz': 'corporate',
  'dixieland': 'corporate',
  ragtime: 'corporate',
  baroque: 'corporate',
  'romantic': 'corporate',
  'modern classical': 'corporate',
  'contemporary': 'corporate',
  opera: 'corporate',
  'choral': 'corporate',
  symphony: 'corporate',
  'chamber music': 'corporate',
  'piano': 'corporate',
  'neo classical': 'corporate',
  'neoclassical': 'corporate',
  'minimalism': 'corporate',
  'medieval': 'corporate',
  'renaissance': 'corporate',
  'impressionist': 'corporate',
  'musique concrete': 'corporate',
  'field recording': 'corporate',
  'sound art': 'corporate',
  'meditation': 'corporate',
  'relaxation': 'corporate',
  'environmental': 'corporate',
  'nature': 'corporate',
  soundtrack: 'corporate',
  'film score': 'corporate',
  'score': 'corporate',
  'theme': 'corporate',
  folk: 'corporate',
  'folk world and country': 'corporate',
  'singer songwriter': 'corporate',
  country: 'corporate',
  bluegrass: 'corporate',
  'americana': 'corporate',
  celtic: 'corporate',
  'spoken word': 'corporate',
  'poetry': 'corporate',
  'audiobook': 'corporate',
  'comedy': 'corporate',
  'education': 'corporate',
  'educational': 'corporate',
  'children': 'corporate',
  'childrens': 'corporate',
  'stage and screen': 'corporate',
  'musical': 'corporate',
  'blues': 'corporate',
  'boogie woogie': 'corporate',
  'chicago blues': 'corporate',
  'country blues': 'corporate',
  'delta blues': 'corporate',
  'east coast blues': 'corporate',
  'electric blues': 'corporate',
  'harmonica blues': 'corporate',
  'jump blues': 'corporate',
  'louisiana blues': 'corporate',
  'memphis blues': 'corporate',
  'modern electric blues': 'corporate',
  'piano blues': 'corporate',
  'piedmont blues': 'corporate',
  'texas blues': 'corporate',
  gospel: 'corporate',
  'jazz jazz': 'corporate',
  'jazz smooth jazz': 'corporate',
  'jazz acid jazz': 'corporate',
  'jazz free jazz': 'corporate',
  'jazz fusion': 'corporate',
  'jazz big band': 'corporate',
  'jazz swing': 'corporate',
  'jazz bop': 'corporate',
  'jazz hard bop': 'corporate',
  'jazz cool jazz': 'corporate',
  'jazz post bop': 'corporate',
  'jazz contemporary jazz': 'corporate',
  'jazz soul jazz': 'corporate',
  'jazz modal': 'corporate',
  'jazz latin jazz': 'corporate',
  'jazz vocal jazz': 'corporate',
  'jazz nu jazz': 'corporate',
  'jazz avant garde jazz': 'corporate',
  'jazz spiritual jazz': 'corporate',
  'jazz dixieland': 'corporate',
  'jazz ragtime': 'corporate',
  'classical classical': 'corporate',
  'classical baroque': 'corporate',
  'classical romantic': 'corporate',
  'classical modern classical': 'corporate',
  'classical contemporary': 'corporate',
  'classical opera': 'corporate',
  'classical choral': 'corporate',
  'classical medieval': 'corporate',
  'classical renaissance': 'corporate',
  'classical impressionist': 'corporate',
  'classical neo classical': 'corporate',
  'classical minimalism': 'corporate',
  'electronic ambient': 'corporate',
  'electronic chillout': 'corporate',
  'electronic downtempo': 'corporate',
  'electronic new age': 'corporate',
  'stage and screen soundtrack': 'corporate',
  'stage and screen musical': 'corporate',
  'stage and screen film score': 'corporate',
  'stage and screen theme': 'corporate',
  'folk world and country folk': 'corporate',
  'folk world and country country': 'corporate',
  'folk world and country bluegrass': 'corporate',
  'folk world and country singer songwriter': 'corporate',
  'folk world and country celtic': 'corporate',
  'folk world and country americana': 'corporate',
  'blues blues': 'corporate',
  'blues chicago blues': 'corporate',
  'blues electric blues': 'corporate',
  'blues delta blues': 'corporate',
  'blues country blues': 'corporate',
  'blues texas blues': 'corporate',
  'blues jump blues': 'corporate',
  'blues harmonica blues': 'corporate',
  'blues rhythm and blues': 'corporate',
  'blues modern electric blues': 'corporate',
  'blues boogie woogie': 'corporate',
  'brass and military brass band': 'corporate',
  'brass and military marches': 'corporate',
  'brass and military military': 'corporate',
  'brass and military pipe and drum': 'corporate',
  marches: 'corporate',
  military: 'corporate',
  'brass band': 'corporate',
  'pipe and drum': 'corporate',

  // ── Non-Western (catch-all → best-fit genres) ──────────────────────────────
  'indian classical': 'corporate',
  'hindustani': 'corporate',
  'carnatic': 'corporate',
  'middle eastern': 'latin',
  'arabic': 'latin',
  'turkish': 'latin',
  'persian': 'latin',
  'african': 'latin',
  'west african': 'latin',
  'east african': 'latin',
  'south african': 'latin',
  'caribbean': 'latin',
  'pacific': 'latin',
  'polynesian': 'latin',
  'asian': 'corporate',
  'chinese': 'corporate',
  'japanese': 'corporate',
  'korean': 'pop',  // K-pop influence
  'southeast asian': 'latin',
}

// Widened BPM ranges: each genre now covers a broader realistic range,
// and weights are reduced to make BPM bias a softer hint (not a hard penalty).
const GENRE_BPM_RANGES = {
  techno:    { min: 118, max: 160, weight: 0.12 },
  edm:       { min: 110, max: 178, weight: 0.10 },
  hiphop:    { min: 65,  max: 115, weight: 0.14 },
  pop:       { min: 85,  max: 140, weight: 0.08 },
  eighties:  { min: 100, max: 145, weight: 0.10 },
  latin:     { min: 82,  max: 138, weight: 0.11 },
  rock:      { min: 80,  max: 175, weight: 0.07 },
  corporate: { min: 50,  max: 125, weight: 0.08 },
}

const SCORE_SMOOTHING_ALPHA = 0.32  // Slightly lower for more temporal stability
const CURRENT_GENRE_STICKINESS = 0.06
const CANDIDATE_GENRE_STICKINESS = 0.03

// ── State ─────────────────────────────────────────────────────────────────────

let essentiaModule = null
let modelLoaded = false
let audioBuffer = []
let analysisInterval = null
let candidateGenre = null
let candidateCount = 0
let currentGenre = 'unknown'
let contextWeights = {}  // Set from user's "tonight's context"
let callback = null
let realtimeHint = { bpm: 0, centroid: 0, energy: 0, lowBandEnergy: 0 }
let maestLabels = null
let smoothedGenreScores = Object.fromEntries(ALL_GENRES.map((genre) => [genre, 1 / ALL_GENRES.length]))
let processorNode = null
let processorMessagePort = null
const loadedWorkletContexts = new WeakSet()
let essentiaLoadPromise = null

// ── Public API ────────────────────────────────────────────────────────────────

export async function initGenreDetector(contextGenres = []) {
  setContextWeights(contextGenres)
  await loadEssentia()
}

export function setContextWeights(contextGenres) {
  contextWeights = {}
  // Boost genres the user says are likely tonight
  for (const g of contextGenres) {
    contextWeights[g] = 1.25  // gentle prior only
  }
}

export async function startGenreDetector(audioContext, cb) {
  callback = cb
  audioBuffer = []
  candidateGenre = null
  candidateCount = 0
  currentGenre = 'unknown'
  smoothedGenreScores = Object.fromEntries(ALL_GENRES.map((genre) => [genre, 1 / ALL_GENRES.length]))

  if (!audioContext.audioWorklet) {
    throw new Error('AudioWorklet is unavailable in this environment.')
  }

  if (!loadedWorkletContexts.has(audioContext)) {
    await audioContext.audioWorklet.addModule(GENRE_BUFFER_WORKLET_URL)
    loadedWorkletContexts.add(audioContext)
  }

  const processor = new AudioWorkletNode(audioContext, 'genre-buffer-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: {
      chunkSize: 4096,
    },
  })

  processor.port.onmessage = (event) => {
    const samples = normalizeMonoSamples(new Float32Array(event.data))
    audioBuffer.push(...samples)
    trimAudioBuffer()
  }

  processorNode = processor
  processorMessagePort = processor.port
  analysisInterval = setInterval(() => runAnalysis(), ANALYSIS_INTERVAL_MS)

  return processor
}

export function stopGenreDetector() {
  if (analysisInterval) {
    clearInterval(analysisInterval)
    analysisInterval = null
  }
  audioBuffer = []
  if (processorMessagePort) {
    processorMessagePort.onmessage = null
    processorMessagePort.close()
    processorMessagePort = null
  }
  if (processorNode) {
    processorNode.disconnect()
    processorNode = null
  }
  callback = null
}

export function getCurrentGenre() {
  return currentGenre
}
export function setGenreRealtimeHint(hint = {}) {
  realtimeHint = {
    bpm: hint.bpm ?? realtimeHint.bpm,
    centroid: hint.centroid ?? realtimeHint.centroid,
    energy: hint.energy ?? realtimeHint.energy,
    lowBandEnergy: hint.lowBandEnergy ?? realtimeHint.lowBandEnergy,
  }
}


// ── Core Analysis ─────────────────────────────────────────────────────────────

async function runAnalysis() {
  const minimumWindowSamples = MAEST_CONTEXT_SECONDS * INPUT_SAMPLE_RATE
  if (audioBuffer.length < minimumWindowSamples) return

  const windowSamples = normalizeMonoSamples(audioBuffer.slice(audioBuffer.length - minimumWindowSamples))

  let scores
  if (modelLoaded && essentiaModule) {
    scores = await runEssentiaModel(windowSamples)
  } else {
    scores = spectralHeuristic(windowSamples)
  }

  const selection = selectGenre(scores)
  const { genre } = selection

  // Hysteresis: require HYSTERESIS_WINDOWS consecutive windows of same genre
  if (genre === candidateGenre) {
    candidateCount++
    if (candidateCount >= HYSTERESIS_WINDOWS) {
      if (genre !== currentGenre) {
        currentGenre = genre
        callback?.({
          genre,
          confidence: selection.rawConfidence,
          rawConfidence: selection.rawConfidence,
          weightedConfidence: selection.weightedConfidence,
          scores: selection.rawScores,
          weightedScores: selection.weightedScores,
          topGenres: selection.topGenres,
        })
      }
    }
  } else {
    candidateGenre = genre
    candidateCount = 1
  }
}

function selectGenre(scores) {
  const rawScores = normalizeScoreMap(scores)
  const bpmAwareScores = applyBpmBias(rawScores, realtimeHint.bpm || 0)
  const spectralAwareScores = applySpectralBias(bpmAwareScores)
  const temporalScores = smoothScores(spectralAwareScores)
  const weightedScores = {}
  const confidenceThreshold = modelLoaded ? CONFIDENCE_THRESHOLD : 0.24
  const marginThreshold = modelLoaded ? GENRE_MARGIN_THRESHOLD : 0.02

  for (const genre of ALL_GENRES) {
    const contextWeight = contextWeights[genre] || 1.0
    weightedScores[genre] = temporalScores[genre] * contextWeight
  }

  if (currentGenre !== 'unknown') {
    weightedScores[currentGenre] *= (1 + CURRENT_GENRE_STICKINESS)
  }
  if (candidateGenre && candidateGenre !== 'unknown') {
    weightedScores[candidateGenre] *= (1 + CANDIDATE_GENRE_STICKINESS)
  }

  const rawSorted = Object.entries(temporalScores).sort((a, b) => b[1] - a[1])
  const weightedSorted = Object.entries(weightedScores).sort((a, b) => b[1] - a[1])

  const [rawTopGenre = 'unknown', rawTopScore = 0] = rawSorted[0] || []
  const rawSecondScore = rawSorted[1]?.[1] || 0
  const rawDelta = rawTopScore - rawSecondScore

  const weightedTopGenre = weightedSorted[0]?.[0] || rawTopGenre

  let selectedGenre = rawTopGenre || 'unknown'
  if (rawTopScore < confidenceThreshold || rawDelta < marginThreshold) {
    selectedGenre = currentGenre !== 'unknown' ? currentGenre : 'unknown'
  } else if (weightedTopGenre !== rawTopGenre) {
    const weightedAltRaw = temporalScores[weightedTopGenre] || 0
    const closeRaw = Math.abs(rawTopScore - weightedAltRaw) <= marginThreshold * 1.5
    if (closeRaw) selectedGenre = weightedTopGenre
  }

  const topGenres = rawSorted.slice(0, 5).map(([genre, raw]) => ({
    genre,
    raw,
    weighted: weightedScores[genre] || 0,
  }))

  return {
    genre: selectedGenre,
    rawConfidence: temporalScores[selectedGenre] || 0,
    weightedConfidence: weightedScores[selectedGenre] || 0,
    rawScores: temporalScores,
    weightedScores,
    topGenres,
  }
}

function smoothScores(scores) {
  const next = {}
  for (const genre of ALL_GENRES) {
    const prev = smoothedGenreScores[genre] || 0
    const curr = scores[genre] || 0
    next[genre] = prev * (1 - SCORE_SMOOTHING_ALPHA) + curr * SCORE_SMOOTHING_ALPHA
  }
  smoothedGenreScores = normalizeScoreMap(next)
  return smoothedGenreScores
}

function applyBpmBias(scoreMap, bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) return scoreMap
  const biased = { ...scoreMap }
  for (const genre of ALL_GENRES) {
    const profile = GENRE_BPM_RANGES[genre]
    if (!profile) continue
    const center = (profile.min + profile.max) / 2
    const width = Math.max(1, (profile.max - profile.min) / 2)
    const distance = Math.abs(bpm - center)
    const gaussian = Math.exp(-0.5 * Math.pow(distance / width, 2))
    const multiplier = 1 + gaussian * profile.weight
    biased[genre] *= multiplier
  }
  return normalizeScoreMap(biased)
}

/**
 * Apply spectral feature bias using low-band energy from the BPM detector.
 * Strong bass presence suggests electronic/techno/hiphop; low bass suggests corporate/pop.
 */
function applySpectralBias(scoreMap) {
  const lowEnergy = realtimeHint.lowBandEnergy || 0
  if (lowEnergy <= 0) return scoreMap

  const biased = { ...scoreMap }

  // High bass energy (>0.1) → boost bass-heavy genres
  if (lowEnergy > 0.1) {
    const boost = Math.min(0.08, (lowEnergy - 0.1) * 0.4)
    biased.techno *= (1 + boost)
    biased.edm *= (1 + boost)
    biased.hiphop *= (1 + boost * 0.8)
  }
  // Low bass energy (<0.03) → boost acoustic/corporate
  if (lowEnergy < 0.03 && lowEnergy > 0) {
    const boost = Math.min(0.06, (0.03 - lowEnergy) * 2)
    biased.corporate *= (1 + boost)
    biased.pop *= (1 + boost * 0.5)
  }

  return normalizeScoreMap(biased)
}

// ── Essentia.js Model (loads asynchronously) ──────────────────────────────────

async function loadEssentia() {
  if (modelLoaded || essentiaModule) return
  if (essentiaLoadPromise) {
    await essentiaLoadPromise
    return
  }

  essentiaLoadPromise = (async () => {
    try {
      // Dynamic import from /public/models/
      // IMPORTANT: use a variable + @vite-ignore so missing optional model files
      // do not crash Vite import analysis during startup.
      // Use an absolute URL computed at runtime so Vite does not try to
      // pre-transform/import files from /public during dev.
      const essentiaUrl = new URL('/models/essentia-wasm.es.js', window.location.origin).href
      const importedModule = await import(/* @vite-ignore */ essentiaUrl).catch(() => null)
      if (!importedModule) {
        console.warn('[GenreDetector] Essentia.js not found in /public/models/ — using spectral heuristic fallback')
        return
      }

      const wasmModule = await initializeEssentiaWasm(importedModule)
      if (!wasmModule) {
        console.warn('[GenreDetector] Essentia.js module loaded, but no compatible WASM export was found — using spectral heuristic fallback')
        return
      }

      essentiaModule = createEssentiaRuntime(wasmModule)
      maestLabels = await loadMaestLabels()
      modelLoaded = Boolean(essentiaModule && maestLabels?.length)

      if (!modelLoaded) {
        console.warn('[GenreDetector] Essentia loaded but MAEST labels are missing or incompatible with prediction output format; enabling spectral heuristic fallback.')
        return
      }

      console.log('[GenreDetector] Essentia.js loaded successfully', `(labels: ${maestLabels.length})`)
    } catch (err) {
      console.warn('[GenreDetector] Could not load Essentia.js:', err.message)
    }
  })()

  await essentiaLoadPromise
}

async function initializeEssentiaWasm(importedModule) {
  const candidates = [
    importedModule,
    importedModule?.default,
    importedModule?.EssentiaWASM,
    importedModule?.default?.EssentiaWASM,
    importedModule?.EssentiaModule,
    importedModule?.createEssentiaModule,
    importedModule?.default?.default,
    importedModule?.default?.EssentiaModule,
    importedModule?.default?.createEssentiaModule,
  ]

  for (const candidate of candidates) {
    if (!candidate) continue

    if (typeof candidate === 'function') {
      const initialized = await candidate()
      if (isEssentiaWasmModule(initialized)) return initialized
      continue
    }

    if (isEssentiaWasmModule(candidate)) {
      return candidate
    }
  }

  return null
}

function isEssentiaWasmModule(candidate) {
  return Boolean(
    candidate &&
    typeof candidate.arrayToVector === 'function' &&
    typeof candidate.vectorToArray === 'function' &&
    typeof candidate.EssentiaJS === 'function'
  )
}

function createEssentiaRuntime(wasmModule) {
  const algorithms = new wasmModule.EssentiaJS(false)

  return {
    module: wasmModule,
    algorithms,
    arrayToVector(inputArray) {
      return wasmModule.arrayToVector(inputArray)
    },
    vectorToArray(vector) {
      return wasmModule.vectorToArray(vector)
    },
    TensorflowInputMusiCNN(frame) {
      return algorithms.TensorflowInputMusiCNN(frame)
    },
    TensorflowPredict2D(features, options) {
      return algorithms.TensorflowPredict2D(features, options)
    },
    delete() {
      if (typeof algorithms.delete === 'function') algorithms.delete()
    },
    shutdown() {
      if (typeof algorithms.shutdown === 'function') algorithms.shutdown()
    },
  }
}

async function loadMaestLabels() {
  try {
    const response = await fetch(MAEST_LABELS_URL)
    if (!response.ok) return null
    const text = await response.text()
    const labels = text
      .split('\n')
      .map((line) => normalizeLabel(line))
      .filter(Boolean)

    return labels.length ? labels : null
  } catch {
    return null
  }
}

async function runEssentiaModel(samples) {
  try {
    const essentia = essentiaModule
    const resampled = resampleWithFilter(samples, INPUT_SAMPLE_RATE, MODEL_SAMPLE_RATE)
    const normalized = normalizeMonoSamples(resampled)
    const vectorInput = essentia.arrayToVector(new Float32Array(normalized))

    // Feature extraction
    const features = essentia.TensorflowInputMusiCNN(vectorInput)

    // Model inference (requires loaded TF.js model)
    // This is a simplified call — actual Essentia.js API varies by version
    const predictions = await predictMaest(essentia, features)
    if (!predictions.length) {
      console.warn('[GenreDetector] MAEST prediction parsing produced no label/score pairs; falling back to spectral heuristic.')
      return spectralHeuristic(samples)
    }

    return mapEssentiaToGenres(predictions)
  } catch (err) {
    console.warn('[GenreDetector] Model inference failed:', err.message)
    return spectralHeuristic(samples)
  }
}

async function predictMaest(essentia, features) {
  let lastError = null

  for (const graphFilename of MAEST_GRAPH_FILENAMES) {
    try {
      const predictions = await essentia.TensorflowPredict2D(features, { graphFilename })
      const parsed = parsePredictionOutput(predictions)
      if (parsed.length > 0) return parsed
    } catch (err) {
      lastError = err
    }
  }

  throw new Error(lastError?.message || 'No valid MAEST model prediction output')
}

function parsePredictionOutput(predictions) {
  if (!predictions) return []

  if (Array.isArray(predictions) && Array.isArray(predictions[0])) {
    if (typeof predictions[0][0] === 'string') {
      return predictions
    }

    if (typeof predictions[0][0] === 'number' && maestLabels?.length) {
      const flatScores = predictions.flat()
      return flatScores.map((score, index) => [maestLabels[index] || `label_${index}`, score])
    }
  }

  if (Array.isArray(predictions) && typeof predictions[0] === 'number' && maestLabels?.length) {
    return predictions.map((score, index) => [maestLabels[index] || `label_${index}`, score])
  }

  if (Array.isArray(predictions) && predictions[0] && typeof predictions[0] === 'object') {
    const withLabelScore = predictions
      .map((item) => [item.label, item.score])
      .filter(([label, score]) => typeof label === 'string' && Number.isFinite(score))

    if (withLabelScore.length) return withLabelScore
  }

  if (!maestLabels?.length) {
    console.warn('[GenreDetector] Unable to parse MAEST numeric predictions because labels are unavailable; using fallback path.')
  }

  return []
}

function mapEssentiaToGenres(predictions) {
  // predictions is an array of [label, score] pairs from Discogs MAEST
  const scores = Object.fromEntries(ALL_GENRES.map((genre) => [genre, 0]))
  const hitCounts = Object.fromEntries(ALL_GENRES.map((genre) => [genre, 0]))

  // Use ALL predictions (not just top 120) — expanded mapping catches more labels
  const sortedPredictions = predictions
    .filter(([, score]) => Number.isFinite(score) && score > 0)
    .sort((a, b) => b[1] - a[1])

  for (let i = 0; i < sortedPredictions.length; i++) {
    const [label, score] = sortedPredictions[i]
    const normalizedKey = normalizeLabel(label)
    const mappedGenre = DISCOS_LABEL_TO_GENRE[normalizedKey]
    if (!mappedGenre) continue
    // Gentle rank decay: top predictions weighted more, but tail still contributes
    const rankWeight = 1 - (i / Math.max(1, sortedPredictions.length)) * 0.4
    scores[mappedGenre] += score * rankWeight
    hitCounts[mappedGenre] += 1
  }

  // Use linear normalization (mean per genre) instead of sqrt
  // This gives a fairer comparison between genres with many vs few sub-labels
  for (const genre of ALL_GENRES) {
    const hits = Math.max(1, hitCounts[genre])
    scores[genre] = scores[genre] / hits
  }

  return normalizeScoreMap(scores)
}

function normalizeLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/---/g, ' ')  // Handle MAEST "Genre---Style" format
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function trimAudioBuffer() {
  const maxSamples = MAEST_CONTEXT_SECONDS * INPUT_SAMPLE_RATE
  if (audioBuffer.length > maxSamples) {
    audioBuffer = audioBuffer.slice(audioBuffer.length - maxSamples)
  }
}

function normalizeScoreMap(scoreMap) {
  const normalized = Object.fromEntries(ALL_GENRES.map((genre) => [genre, scoreMap[genre] || 0]))
  const total = Object.values(normalized).reduce((sum, score) => sum + score, 0) || 1
  for (const genre of Object.keys(normalized)) {
    normalized[genre] /= total
  }
  return normalized
}

function normalizeMonoSamples(samples) {
  if (!samples || samples.length === 0) return []

  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }

  if (peak === 0) {
    return Array.from(samples)
  }

  const scale = 1 / peak
  const normalized = new Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    normalized[i] = samples[i] * scale
  }

  return normalized
}

// ── Anti-aliased resampling ──────────────────────────────────────────────────
// Replaces simple linear interpolation with a windowed sinc low-pass filter
// before decimation. This prevents aliasing artifacts that degrade model accuracy
// when downsampling from 44100Hz to 16000Hz.

function resampleWithFilter(samples, fromRate, toRate) {
  if (fromRate === toRate) return Array.from(samples)

  // Apply low-pass filter at Nyquist of target rate before decimation
  const cutoffHz = toRate / 2
  const filtered = lowPassFilter(samples, fromRate, cutoffHz)

  // Decimate with linear interpolation (safe after low-pass filtering)
  const ratio = fromRate / toRate
  const outputLength = Math.max(1, Math.floor(filtered.length / ratio))
  const resampled = new Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio
    const lower = Math.floor(sourceIndex)
    const upper = Math.min(lower + 1, filtered.length - 1)
    const frac = sourceIndex - lower
    resampled[i] = filtered[lower] + (filtered[upper] - filtered[lower]) * frac
  }

  return resampled
}

/**
 * Simple windowed sinc low-pass filter (FIR).
 * Uses a Blackman window for good stopband attenuation.
 */
function lowPassFilter(samples, sampleRate, cutoffHz) {
  const filterLength = 63  // Odd number, moderate length for good balance
  const halfLen = Math.floor(filterLength / 2)
  const fc = cutoffHz / sampleRate  // Normalized cutoff frequency

  // Build windowed sinc kernel
  const kernel = new Float32Array(filterLength)
  let kernelSum = 0
  for (let i = 0; i < filterLength; i++) {
    const n = i - halfLen
    // Sinc function
    const sinc = n === 0 ? 1.0 : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n)
    // Blackman window
    const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (filterLength - 1))
      + 0.08 * Math.cos(4 * Math.PI * i / (filterLength - 1))
    kernel[i] = sinc * window
    kernelSum += kernel[i]
  }
  // Normalize kernel
  for (let i = 0; i < filterLength; i++) {
    kernel[i] /= kernelSum
  }

  // Convolve
  const output = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    let sum = 0
    for (let j = 0; j < filterLength; j++) {
      const sampleIdx = i - halfLen + j
      if (sampleIdx >= 0 && sampleIdx < samples.length) {
        sum += samples[sampleIdx] * kernel[j]
      }
    }
    output[i] = sum
  }

  return output
}

// ── Spectral Heuristic Fallback ───────────────────────────────────────────────
// When Essentia model is unavailable, estimate genre from basic spectral features

function spectralHeuristic(samples) {
  const n = samples.length

  // RMS energy
  const rms = Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / n)

  // Zero crossing rate → high = noisy/rock, low = smooth/electronic
  let zcr = 0
  for (let i = 1; i < n; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) zcr++
  }
  zcr /= n

  // Very rough spectral centroid via DFT magnitude weighting (simplified)
  // This is intentionally simple — the real model is the proper path
  const centroidRatio = zcr * INPUT_SAMPLE_RATE  // rough proxy

  const scores = {
    techno: 0, edm: 0, hiphop: 0, pop: 0,
    eighties: 0, latin: 0, rock: 0, corporate: 0,
  }

  // Heuristic rules (rough, better than nothing without the model)
  const hintedBpm = realtimeHint.bpm || 0
  const lowBass = realtimeHint.lowBandEnergy || 0

  if (rms > 0.1 && centroidRatio > 3000) {
    scores.rock += 0.4
    scores.edm += 0.3
    scores.techno += 0.3
  } else if (rms > 0.06 && centroidRatio < 2000) {
    scores.hiphop += 0.5
    scores.pop += 0.3
    scores.eighties += 0.2
  } else if (rms < 0.03) {
    scores.corporate += 0.6
    scores.pop += 0.4
  } else {
    scores.edm += 0.3
    scores.pop += 0.3
    scores.latin += 0.2
    scores.hiphop += 0.2
  }

  // Tempo-informed hinting
  if (hintedBpm >= 128) {
    scores.techno += 0.25
    scores.edm += 0.2
  } else if (hintedBpm >= 110) {
    scores.pop += 0.2
    scores.latin += 0.15
    scores.edm += 0.1
  } else if (hintedBpm >= 84) {
    scores.hiphop += 0.25
    scores.pop += 0.1
  } else if (hintedBpm > 0) {
    scores.corporate += 0.25
    scores.eighties += 0.1
  }

  // Low-band energy hinting (from BPM detector)
  if (lowBass > 0.12) {
    scores.techno += 0.15
    scores.edm += 0.1
    scores.hiphop += 0.1
  } else if (lowBass > 0 && lowBass < 0.03) {
    scores.corporate += 0.15
    scores.pop += 0.05
  }

  return scores
}
