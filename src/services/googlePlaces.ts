// Google Maps & Places Integration Service

export interface PlaceResult {
  name: string;
  formattedAddress: string;
  lat: number;
  lon: number;
  city: string;
  country: string;
  code: string;
}

const GOOGLE_MAPS_KEY =
  (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ||
  'AIzaSyCDvE3wz9FXB_1JqbmkLqk4gZ4M9iSm6_I';

let scriptLoadingPromise: Promise<boolean> | null = null;

export function loadGoogleMapsScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if ((window as any).google?.maps?.places || (window as any).google?.maps?.routes) {
    return Promise.resolve(true);
  }
  if (scriptLoadingPromise) return scriptLoadingPromise;

  scriptLoadingPromise = new Promise((resolve) => {
    if ((window as any).google?.maps?.places || (window as any).google?.maps?.routes) {
      resolve(true);
      return;
    }

    const existing = document.getElementById('google-maps-script');
    if (existing) {
      if ((window as any).google?.maps) {
        resolve(true);
        return;
      }
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    const callbackName = '__googleMapsInitCallback';
    (window as any)[callbackName] = () => {
      try {
        delete (window as any)[callbackName];
      } catch {}
      resolve(true);
    };

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    // Use recommended asynchronous loading (loading=async) with callback and required libraries
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places,routes,geometry&loading=async&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if ((window as any).google?.maps) {
        resolve(true);
      }
    };
    script.onerror = () => {
      console.warn('Failed to load Google Maps script. Fallback geocoder active.');
      try {
        delete (window as any)[callbackName];
      } catch {}
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return scriptLoadingPromise;
}

// Common global airport & hub codes for fallback
const HUB_CODES: Record<string, string> = {
  'new york': 'NYC',
  'washington': 'WAS',
  'boston': 'BOS',
  'chicago': 'ORD',
  'san francisco': 'SFO',
  'los angeles': 'LAX',
  'london': 'LHR',
  'paris': 'CDG',
  'tokyo': 'HND',
  'frankfurt': 'FRA',
  'berlin': 'BER',
  'toronto': 'YYZ',
  'singapore': 'SIN',
  'sydney': 'SYD',
  'dubai': 'DXB',
  'mumbai': 'BOM',
  'delhi': 'DEL',
  'bengaluru': 'BLR',
  'bangalore': 'BLR',
  'ahmedabad': 'AMD',
  'nadiad': 'NAD',
  'talaja': 'TAL',
  'bhavnagar': 'BVP',
  'vadodara': 'BDQ',
  'surat': 'ST',
  'seattle': 'SEA',
  'austin': 'AUS',
};

function deriveCode(name: string, city: string): string {
  const norm = (city || name).toLowerCase();
  for (const [key, val] of Object.entries(HUB_CODES)) {
    if (norm.includes(key)) return val;
  }
  const clean = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  return clean.slice(0, 3) || 'LOC';
}

export async function fetchPlacePredictions(input: string): Promise<{ description: string; placeId: string }[]> {
  if (!input || input.trim().length < 2) return [];

  const loaded = await loadGoogleMapsScript();
  const google = (window as any).google;

  if (loaded && google?.maps) {
    let AutocompleteSuggestion = google.maps.places?.AutocompleteSuggestion;
    if (!AutocompleteSuggestion && typeof google.maps.importLibrary === 'function') {
      try {
        const placesLib = await google.maps.importLibrary('places');
        AutocompleteSuggestion = placesLib?.AutocompleteSuggestion;
      } catch (e) {
        console.warn('Google Maps importLibrary("places") error:', e);
      }
    }

    if (AutocompleteSuggestion && typeof AutocompleteSuggestion.fetchAutocompleteSuggestions === 'function') {
      try {
        const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
        });
        if (response?.suggestions && Array.isArray(response.suggestions)) {
          return response.suggestions
            .filter((s: any) => s?.placePrediction)
            .map((s: any) => {
              const pred = s.placePrediction;
              const placeId =
                pred.placeId ||
                (typeof pred.toPlace === 'function' ? pred.toPlace()?.id : '') ||
                '';
              const description =
                typeof pred.text?.toString === 'function'
                  ? pred.text.toString()
                  : typeof pred.text === 'string'
                  ? pred.text
                  : pred.mainText?.toString?.() || '';
              return {
                description: description || 'Selected Place',
                placeId,
              };
            })
            .filter((item: { description: string; placeId: string }) => item.description);
        }
      } catch (err) {
        console.warn('Google AutocompleteSuggestion error:', err);
      }
    }
  }

  return [];
}

export async function resolvePlaceDetails(placeId: string, fallbackDescription?: string): Promise<PlaceResult | null> {
  const loaded = await loadGoogleMapsScript();
  const google = (window as any).google;

  if (loaded && google?.maps) {
    // Try Geocoder first with placeId
    if (google.maps.Geocoder) {
      try {
        const geocoder = new google.maps.Geocoder();
        const res: any = await new Promise((resolve, reject) => {
          geocoder.geocode({ placeId }, (results: any[], status: any) => {
            if (status === 'OK' && results && results[0]) {
              resolve(results[0]);
            } else {
              reject(status);
            }
          });
        });

        if (res) {
          const lat = res.geometry.location.lat();
          const lon = res.geometry.location.lng();
          let city = '';
          let country = '';

          for (const comp of res.address_components || []) {
            if (comp.types.includes('locality') || comp.types.includes('postal_town')) {
              city = comp.long_name;
            }
            if (comp.types.includes('country')) {
              country = comp.long_name;
            }
          }

          const name = res.formatted_address.split(',')[0] || res.formatted_address;
          return {
            name,
            formattedAddress: res.formatted_address,
            lat,
            lon,
            city: city || name,
            country: country || 'Global',
            code: deriveCode(name, city),
          };
        }
      } catch (e) {
        console.warn('Geocoder by placeId error:', e);
      }
    }
  }

  // Fallback direct geocode if needed
  if (fallbackDescription) {
    return directGeocode(fallbackDescription);
  }

  return null;
}

export async function directGeocode(query: string): Promise<PlaceResult | null> {
  if (!query || !query.trim()) return null;

  const loaded = await loadGoogleMapsScript();
  const google = (window as any).google;

  if (loaded && google?.maps?.Geocoder) {
    try {
      const geocoder = new google.maps.Geocoder();
      const res: any = await new Promise((resolve, reject) => {
        geocoder.geocode({ address: query }, (results: any[], status: any) => {
          if (status === 'OK' && results && results[0]) {
            resolve(results[0]);
          } else {
            reject(status);
          }
        });
      });

      if (res) {
        const lat = res.geometry.location.lat();
        const lon = res.geometry.location.lng();
        let city = '';
        let country = '';

        for (const comp of res.address_components || []) {
          if (comp.types.includes('locality') || comp.types.includes('postal_town')) {
            city = comp.long_name;
          }
          if (comp.types.includes('country')) {
            country = comp.long_name;
          }
        }

        const name = res.formatted_address.split(',')[0] || res.formatted_address;
        return {
          name,
          formattedAddress: res.formatted_address,
          lat,
          lon,
          city: city || name,
          country: country || 'Global',
          code: deriveCode(name, city),
        };
      }
    } catch (e) {
      console.warn('Google direct geocode error:', e);
    }
  }

  // Local fallback coordinates calculation based on common cities or deterministic hash
  const lower = query.toLowerCase();
  if (lower.includes('york')) {
    return { name: 'New York, NY', formattedAddress: 'New York, NY, USA', lat: 40.7128, lon: -74.006, city: 'New York', country: 'USA', code: 'NYC' };
  }
  if (lower.includes('washington')) {
    return { name: 'Washington, DC', formattedAddress: 'Washington, DC, USA', lat: 38.9072, lon: -77.0369, city: 'Washington', country: 'USA', code: 'WAS' };
  }
  if (lower.includes('boston')) {
    return { name: 'Boston, MA', formattedAddress: 'Boston, MA, USA', lat: 42.3601, lon: -71.0589, city: 'Boston', country: 'USA', code: 'BOS' };
  }
  if (lower.includes('chicago')) {
    return { name: 'Chicago, IL', formattedAddress: 'Chicago, IL, USA', lat: 41.8781, lon: -87.6298, city: 'Chicago', country: 'USA', code: 'ORD' };
  }
  if (lower.includes('san francisco')) {
    return { name: 'San Francisco, CA', formattedAddress: 'San Francisco, CA, USA', lat: 37.7749, lon: -122.4194, city: 'San Francisco', country: 'USA', code: 'SFO' };
  }
  if (lower.includes('los angeles')) {
    return { name: 'Los Angeles, CA', formattedAddress: 'Los Angeles, CA, USA', lat: 34.0522, lon: -118.2437, city: 'Los Angeles', country: 'USA', code: 'LAX' };
  }
  if (lower.includes('london')) {
    return { name: 'London, UK', formattedAddress: 'London, United Kingdom', lat: 51.5074, lon: -0.1278, city: 'London', country: 'UK', code: 'LHR' };
  }
  if (lower.includes('paris')) {
    return { name: 'Paris, France', formattedAddress: 'Paris, France', lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'France', code: 'CDG' };
  }
  if (lower.includes('tokyo')) {
    return { name: 'Tokyo, Japan', formattedAddress: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, city: 'Tokyo', country: 'Japan', code: 'HND' };
  }
  if (lower.includes('nadiad') || lower === 'nad') {
    return { name: 'Nadiad, Gujarat', formattedAddress: 'Nadiad, Gujarat, India', lat: 22.6916, lon: 72.8634, city: 'Nadiad', country: 'India', code: 'NAD' };
  }
  if (lower.includes('talaja') || lower === 'tal') {
    return { name: 'Talaja, Gujarat', formattedAddress: 'Talaja, Gujarat, India', lat: 21.3541, lon: 72.0435, city: 'Talaja', country: 'India', code: 'TAL' };
  }
  if (lower.includes('ahmedabad') || lower === 'amd') {
    return { name: 'Ahmedabad, Gujarat', formattedAddress: 'Ahmedabad, Gujarat, India', lat: 23.0225, lon: 72.5714, city: 'Ahmedabad', country: 'India', code: 'AMD' };
  }
  if (lower.includes('mumbai') || lower === 'bom') {
    return { name: 'Mumbai, Maharashtra', formattedAddress: 'Mumbai, Maharashtra, India', lat: 19.076, lon: 72.8777, city: 'Mumbai', country: 'India', code: 'BOM' };
  }
  if (lower.includes('delhi') || lower === 'del') {
    return { name: 'Delhi, India', formattedAddress: 'New Delhi, Delhi, India', lat: 28.6139, lon: 77.209, city: 'Delhi', country: 'India', code: 'DEL' };
  }
  if (lower.includes('bhavnagar') || lower === 'bvp') {
    return { name: 'Bhavnagar, Gujarat', formattedAddress: 'Bhavnagar, Gujarat, India', lat: 21.7645, lon: 72.1519, city: 'Bhavnagar', country: 'India', code: 'BVP' };
  }

  // Generic fallback with simulated coordinates
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    hash = (hash << 5) - hash + query.charCodeAt(i);
  }
  const mockLat = 30 + (Math.abs(hash) % 30);
  const mockLon = -100 + (Math.abs(hash >> 3) % 180);

  return {
    name: query.trim(),
    formattedAddress: query.trim(),
    lat: Number(mockLat.toFixed(4)),
    lon: Number(mockLon.toFixed(4)),
    city: query.trim().split(',')[0],
    country: 'Global',
    code: deriveCode(query, query),
  };
}
