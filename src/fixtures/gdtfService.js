const SEARCH_CACHE_KEY = 'gma3disco.fixtureProfile.searchCache.v1'
const PROFILE_CACHE_KEY = 'gma3disco.fixtureProfile.detailCache.v1'
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

const searchCache = new Map()
const detailCache = new Map()

const ATTR_KEYS = ['pt', 'rgb', 'colorWheel', 'dimmer', 'strobe', 'zoom', 'gobo']

function hasWindow() {
  return typeof window !== 'undefined'
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function loadPersistedCache(cacheKey, targetMap) {
  if (!hasWindow()) return
  let raw = null
  try {
    raw = window.localStorage.getItem(cacheKey)
  } catch {
    return
  }
  if (!raw) return
  const parsed = safeJsonParse(raw, {})
  const now = Date.now()
  Object.entries(parsed).forEach(([key, entry]) => {
    if (!entry || (entry.expiresAt && entry.expiresAt < now)) return
    targetMap.set(key, entry)
  })
}

function persistCache(cacheKey, sourceMap) {
  if (!hasWindow()) return
  const serializable = {}
  sourceMap.forEach((value, key) => {
    serializable[key] = value
  })
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(serializable))
  } catch {
    // localStorage may be unavailable in privacy-hardened contexts; skip persistence.
  }
}

loadPersistedCache(SEARCH_CACHE_KEY, searchCache)
loadPersistedCache(PROFILE_CACHE_KEY, detailCache)

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}


function sanitizeQuery(value) {
  return String(value || '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildSearchKey(params) {
  return JSON.stringify({
    query: normalizeText(params.query),
    manufacturer: normalizeText(params.manufacturer),
    model: normalizeText(params.model),
    mode: normalizeText(params.mode),
  })
}

function normalizeSearchResults(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.fixtures)
        ? payload.fixtures
        : Array.isArray(payload?.data)
          ? payload.data
          : null

  if (list) {
    return list.map((item, index) => {
      const manufacturer = item.manufacturer || item.manufacturerName || item.brand || item.manu || 'Unknown'
      const model = item.model || item.name || item.fixture || item.shortName || `Fixture ${index + 1}`
      const id = item.id
        || item.key
        || [item.manufacturerKey, item.fixtureKey].filter(Boolean).join('/')
        || `${manufacturer}/${model}`

      return {
        id,
        manufacturer,
        model,
        modes: item.modes || [],
        raw: item,
      }
    })
  }

  if (payload?.fixtures && typeof payload.fixtures === 'object') {
    return Object.entries(payload.fixtures).map(([id, fixture], index) => {
      const [manufacturerKey, fixtureKey] = String(id).split('/')
      const manufacturer = fixture?.manufacturer
        || payload?.manufacturers?.[manufacturerKey]?.name
        || manufacturerKey
        || 'Unknown'
      const model = fixture?.name || fixture?.model || fixtureKey || `Fixture ${index + 1}`

      return {
        id,
        manufacturer,
        model,
        modes: fixture?.modes || [],
        raw: fixture,
      }
    })
  }

  return []
}

function filterByFields(items, params) {
  const queryNeedle = normalizeText(params.query)
  const manufacturerNeedle = normalizeText(params.manufacturer)
  const modelNeedle = normalizeText(params.model)

  return items.filter((item) => {
    const joined = normalizeText([item.manufacturer, item.model].filter(Boolean).join(' '))
    const matchesQuery = !queryNeedle || joined.includes(queryNeedle)
    const matchesManufacturer = !manufacturerNeedle
      || normalizeText(item.manufacturer).includes(manufacturerNeedle)
    const matchesModel = !modelNeedle
      || normalizeText(item.model).includes(modelNeedle)
    return matchesQuery && matchesManufacturer && matchesModel
  })
}

function emptyCapabilities() {
  return ATTR_KEYS.reduce((acc, key) => ({ ...acc, [key]: false }), {})
}

function inspectChannels(rawMode = {}) {
  const channels = [
    ...(rawMode.channels || []),
    ...(rawMode.dmxChannels || []),
    ...(rawMode.channelFunctions || []),
  ]

  return channels.map(ch => normalizeText(ch.name || ch.attribute || ch.type || ch.feature || ch))
}

function normalizeCapabilitiesFromProfile(profile, modeName) {
  const capabilities = emptyCapabilities()
  const mode = (profile.modes || []).find(m => normalizeText(m.name) === normalizeText(modeName)) || profile.modes?.[0] || {}
  const descriptors = inspectChannels(mode)

  descriptors.forEach((text) => {
    if (!text) return
    if (text.includes('pan') || text.includes('tilt')) capabilities.pt = true
    if (text.includes('rgb') || text.includes('red') || text.includes('green') || text.includes('blue') || text.includes('cmy')) capabilities.rgb = true
    if (text.includes('color wheel') || text.includes('colour wheel') || text.includes('color macro') || text.includes('color select')) capabilities.colorWheel = true
    if (text.includes('dimmer') || text.includes('intensity')) capabilities.dimmer = true
    if (text.includes('strobe') || text.includes('shutter')) capabilities.strobe = true
    if (text.includes('zoom') || text.includes('iris')) capabilities.zoom = true
    if (text.includes('gobo')) capabilities.gobo = true
  })

  return capabilities
}

function suggestFixtureType(profile, capabilities) {
  const text = normalizeText([
    profile.manufacturer,
    profile.model,
    profile.categories?.join(' '),
  ].join(' '))

  if (text.includes('strobe')) return 'Strobe'
  if (text.includes('blinder')) return 'Blinder'
  if (text.includes('bar') || text.includes('batten')) return 'LED Bar / Batten'
  if (text.includes('par')) return 'LED PAR'
  if (capabilities.pt && text.includes('wash')) return 'Moving Head (Wash)'
  if (capabilities.pt && text.includes('beam')) return 'Moving Head (Beam)'
  if (capabilities.pt && text.includes('spot')) return 'Moving Head (Spot)'
  if (capabilities.pt) return 'Moving Head (Spot)'
  if (capabilities.rgb) return 'LED PAR'
  return 'Other'
}

async function fetchFromProvider(url) {
  const payload = await fetchJson(url)
  return normalizeSearchResults(payload)
}

function normalizeGdtfShareResults(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.results || payload?.fixtures || payload?.data || []

  if (!Array.isArray(list)) return []

  return list.map((item, index) => {
    const manufacturer = item.manufacturer || item.brand || item.company || item.vendor || 'Unknown'
    const model = item.model || item.name || item.fixtureName || item.fixture || `Fixture ${index + 1}`
    const fixtureType = item.fixtureType || item.type || item.category || 'Other'
    return {
      id: `gdtf-share:${encodeURIComponent(manufacturer)}/${encodeURIComponent(model)}`,
      manufacturer,
      model,
      modes: item.modes || [],
      raw: { ...item, fixtureType },
      source: 'gdtf-share',
    }
  })
}

async function fetchSearchFromProviders(query) {
  const encoded = encodeURIComponent(query)
  const sanitized = encodeURIComponent(sanitizeQuery(query))

  const oflProviders = [
    `https://open-fixture-library.org/api/v1/get-search-results?query=${encoded}`,
    `https://open-fixture-library.org/api/v1/search?query=${encoded}`,
    `https://open-fixture-library.org/api/v1/get-search-results?query=${sanitized}`,
  ]

  const gdtfShareProviders = [
    `https://gdtf-share.com/apis/public/getList.php?search=${encoded}`,
    `https://gdtf-share.com/apis/public/getFixtures.php?search=${encoded}`,
    `https://gdtf-share.com/api/public/fixtures?search=${encoded}`,
  ]

  const errors = []

  for (const url of oflProviders) {
    try {
      const normalized = await fetchFromProvider(url)
      if (normalized.length > 0) return normalized
    } catch (error) {
      errors.push(error)
    }
  }

  for (const url of gdtfShareProviders) {
    try {
      const payload = await fetchJson(url)
      const normalized = normalizeGdtfShareResults(payload)
      if (normalized.length > 0) return normalized
    } catch (error) {
      errors.push(error)
    }
  }

  const firstError = errors[0]
  if (firstError) throw firstError
  return []
}

export async function searchFixtureDefinitions(params = {}) {
  const cacheKey = buildSearchKey(params)
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const query = sanitizeQuery(params.query || `${params.manufacturer || ''} ${params.model || ''}`.trim())
  if (!query) return []

  try {
    const remote = await fetchSearchFromProviders(query)
    const filtered = filterByFields(remote, params)
    const entry = { data: filtered, expiresAt: Date.now() + CACHE_TTL_MS }
    searchCache.set(cacheKey, entry)
    persistCache(SEARCH_CACHE_KEY, searchCache)
    return filtered
  } catch {
    return []
  }
}

async function fetchProfileDetailById(profileId, profileSummary = null) {
  if (String(profileId).startsWith('gdtf-share:')) {
    const parsed = String(profileId).replace('gdtf-share:', '').split('/')
    const manufacturer = decodeURIComponent(parsed[0] || profileSummary?.manufacturer || 'Unknown')
    const model = decodeURIComponent(parsed[1] || profileSummary?.model || 'Fixture')
    return {
      id: profileId,
      manufacturer,
      model,
      categories: [profileSummary?.raw?.fixtureType || 'Other'],
      modes: profileSummary?.modes || [],
      raw: profileSummary?.raw || {},
    }
  }

  const [manufacturerKey, fixtureKey] = String(profileId).split('/')
  if (!manufacturerKey || !fixtureKey) {
    throw new Error('Unsupported fixture profile id format')
  }

  const url = `https://open-fixture-library.org/api/v1/fixture/${encodeURIComponent(manufacturerKey)}/${encodeURIComponent(fixtureKey)}`
  const payload = await fetchJson(url)

  const modes = Array.isArray(payload?.modes)
    ? payload.modes
    : Object.entries(payload?.availableChannels || {}).map(([name]) => ({ name, channels: [name] }))

  return {
    id: profileId,
    manufacturer: payload?.manufacturer?.name || payload?.manufacturer || manufacturerKey,
    model: payload?.name || fixtureKey,
    categories: payload?.categories || [],
    modes,
    raw: payload,
  }
}

export async function getFixtureProfile(profileSummary, selectedModeName) {
  if (!profileSummary?.id) return null

  const cacheKey = String(profileSummary.id)
  const cached = detailCache.get(cacheKey)
  let detail = null

  if (cached && cached.expiresAt > Date.now()) {
    detail = cached.data
  } else {
    try {
      detail = await fetchProfileDetailById(profileSummary.id, profileSummary)
      const entry = { data: detail, expiresAt: Date.now() + CACHE_TTL_MS }
      detailCache.set(cacheKey, entry)
      persistCache(PROFILE_CACHE_KEY, detailCache)
    } catch {
      return null
    }
  }

  const capabilities = normalizeCapabilitiesFromProfile(detail, selectedModeName)
  return {
    ...detail,
    selectedModeName: selectedModeName || detail.modes?.[0]?.name || '',
    capabilities,
    fixtureType: suggestFixtureType(detail, capabilities),
  }
}

export function getDefaultCapabilities() {
  return { pt: false, rgb: false, colorWheel: false, strobe: false, dimmer: true, zoom: false, gobo: false }
}
