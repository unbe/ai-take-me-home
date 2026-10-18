/**
 * storage.js - Persistent configuration & Home Screen shortcut management
 *
 * Requirements:
 * 1. Must save destination coordinates/address and flight/search settings.
 * 2. Must NOT save the current pilot position or altitude (live GPS must be used on launch).
 * 3. When destination or settings change, saved configuration updates so installed shortcuts stay in sync.
 */

export const Storage = {
  STORAGE_KEY: 'takemehome_config',
  INTRO_SEEN_KEY: 'takemehome_intro_seen',

  /**
   * Checks whether the user has already seen the first-launch introduction
   * @returns {boolean}
   */
  hasSeenIntro() {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(this.INTRO_SEEN_KEY) === 'true';
    } catch {
      return false;
    }
  },

  /**
   * Marks that the user has seen the first-launch introduction
   */
  markIntroSeen() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.INTRO_SEEN_KEY, 'true');
    } catch (err) {
      console.warn('[Storage] Failed to save intro seen flag:', err);
    }
  },

  /**
   * Saves destination and settings to persistent local storage.
   * Deliberately excludes pilot position and altitude.
   *
   * @param {Object} destination { lat, lon, address }
   * @param {Object} settings { stopsCount, searchRadiusKm, speedKmH, bufferMinutes, maxGlideRatio }
   */
  saveConfig(destination, settings) {
    if (typeof localStorage === 'undefined') return;

    try {
      const payload = {
        destination: {
          lat: Number(destination.lat),
          lon: Number(destination.lon),
          address: destination.address || null,
        },
        settings: {
          stopsCount: Number(settings.stopsCount),
          searchRadiusKm: Number(settings.searchRadiusKm),
          speedKmH: Number(settings.speedKmH),
          bufferMinutes: Number(settings.bufferMinutes),
          maxGlideRatio: Number(settings.maxGlideRatio),
        },
        updatedAt: Date.now(),
      };

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
      console.log('[Storage] Saved persistent destination & settings:', payload);
    } catch (err) {
      console.warn('[Storage] Failed to save config to localStorage:', err);
    }
  },

  /**
   * Loads saved destination and settings from persistent local storage.
   * @returns {{ destination: Object, settings: Object } | null}
   */
  loadConfig() {
    if (typeof localStorage === 'undefined') return null;

    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;

      const result = {};

      if (data.destination && isFinite(data.destination.lat) && isFinite(data.destination.lon)) {
        result.destination = {
          lat: Number(data.destination.lat),
          lon: Number(data.destination.lon),
          address: data.destination.address || null,
        };
      }

      if (data.settings && typeof data.settings === 'object') {
        const s = data.settings;
        result.settings = {};
        if (Number(s.stopsCount) > 0) result.settings.stopsCount = Number(s.stopsCount);
        if (Number(s.searchRadiusKm) > 0) result.settings.searchRadiusKm = Number(s.searchRadiusKm);
        if (Number(s.speedKmH) > 0) result.settings.speedKmH = Number(s.speedKmH);
        if (Number(s.bufferMinutes) >= 0) result.settings.bufferMinutes = Number(s.bufferMinutes);
        if (Number(s.maxGlideRatio) > 0) result.settings.maxGlideRatio = Number(s.maxGlideRatio);
      }

      return result;
    } catch (err) {
      console.warn('[Storage] Failed to read config from localStorage:', err);
      return null;
    }
  },

  /**
   * Builds a clean URL for shortcut bookmarking:
   * Encodes destination and settings, but explicitly EXCLUDES pilot lat, lon, and altitude.
   *
   * @param {Object} destination
   * @param {Object} settings
   * @returns {string} Clean URL for home screen shortcuts
   */
  getCleanShortcutUrl(destination, settings) {
    const params = new URLSearchParams();

    if (destination && isFinite(destination.lat) && isFinite(destination.lon)) {
      params.set('destLat', Number(destination.lat).toFixed(5));
      params.set('destLon', Number(destination.lon).toFixed(5));
    }

    if (settings) {
      if (settings.searchRadiusKm) params.set('radius', settings.searchRadiusKm);
      if (settings.stopsCount) params.set('stops', settings.stopsCount);
      if (settings.speedKmH) params.set('speed', settings.speedKmH);
      if (settings.bufferMinutes !== undefined) params.set('buffer', settings.bufferMinutes);
      if (settings.maxGlideRatio) params.set('glide', settings.maxGlideRatio);
    }

    const qs = params.toString();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
    return `${origin}${pathname}${qs ? '?' + qs : ''}`;
  },

  /**
   * Prepares the current browser environment for shortcut / Home Screen creation:
   * 1. Persists destination & settings to localStorage.
   * 2. Cleans the browser address bar (via replaceState) of pilot coordinates so that Safari / browsers
   *    bookmarking the current tab do NOT bake the current pilot position into the shortcut.
   */
  prepareForShortcutCreation(destination, settings) {
    this.saveConfig(destination, settings);

    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      const cleanUrl = this.getCleanShortcutUrl(destination, settings);
      window.history.replaceState(null, '', cleanUrl);
      console.log('[Storage] Cleaned address bar for shortcut creation:', cleanUrl);
    }
  },

  /**
   * Checks if the app is currently running in standalone / PWA installed mode
   * @returns {boolean}
   */
  isStandalone() {
    if (typeof window === 'undefined') return false;
    return !!(
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  },

  /**
   * Detects mobile operating system / browser environment
   * @returns {'ios' | 'android' | 'desktop'}
   */
  detectPlatform() {
    if (typeof navigator === 'undefined') return 'desktop';
    const ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/android/i.test(ua)) return 'android';
    return 'desktop';
  },
};
