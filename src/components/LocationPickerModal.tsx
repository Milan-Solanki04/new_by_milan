import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin,
  Search,
  X,
  Navigation,
  Loader2,
  Check,
  AlertCircle,
  LocateFixed,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { PlaceResult } from '../services/googlePlaces';

interface LocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedPlace: PlaceResult) => void;
  title: string;
  initialPlace?: PlaceResult;
  type?: 'origin' | 'destination' | 'intermediate';
}

// Generate a modern, retina-ready marker icon with custom color
function createMapPinIcon(isDestination: boolean) {
  const color = isDestination ? '#059669' : '#2563eb';
  return L.divIcon({
    className: 'leaflet-custom-marker-icon',
    html: `
      <div style="position: relative; width: 36px; height: 44px; display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 4px 6px rgba(15, 23, 42, 0.35));">
        <div style="width: 34px; height: 34px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background-color: ${color}; border: 3px solid #ffffff; display: flex; align-items: center; justify-content: center;">
          <div style="width: 10px; height: 10px; background-color: #ffffff; border-radius: 50%; transform: rotate(45deg);"></div>
        </div>
        <div style="width: 12px; height: 4px; background: rgba(0,0,0,0.3); border-radius: 50%; margin-top: 1px;"></div>
      </div>
    `,
    iconSize: [36, 44],
    iconAnchor: [18, 42],
    popupAnchor: [0, -42],
  });
}

// Derive a 3-letter airport or station code fallback
function deriveCodeFromPlace(name: string, city: string): string {
  const norm = `${name} ${city}`.toLowerCase();
  const known: Record<string, string> = {
    mumbai: 'BOM',
    delhi: 'DEL',
    bengaluru: 'BLR',
    bangalore: 'BLR',
    ahmedabad: 'AMD',
    nadiad: 'NAD',
    talaja: 'TAL',
    bhavnagar: 'BVP',
    vadodara: 'BDQ',
    surat: 'ST',
    goa: 'GOI',
    london: 'LHR',
    paris: 'CDG',
    'new york': 'NYC',
    washington: 'WAS',
    tokyo: 'HND',
    seattle: 'SEA',
    'san francisco': 'SFO',
    boston: 'BOS',
  };
  for (const [k, v] of Object.entries(known)) {
    if (norm.includes(k)) return v;
  }
  const clean = (city || name).replace(/[^A-Za-z]/g, '').toUpperCase();
  return clean.slice(0, 3) || 'LOC';
}

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  initialPlace,
  type = 'origin',
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Default coordinate if none provided (e.g. Mumbai or default city)
  const defaultLat = initialPlace?.lat && !isNaN(initialPlace.lat) ? initialPlace.lat : 19.076;
  const defaultLng = initialPlace?.lon && !isNaN(initialPlace.lon) ? initialPlace.lon : 72.8777;

  const [selectedLocation, setSelectedLocation] = useState<PlaceResult>({
    name: initialPlace?.name || 'Selected Location',
    formattedAddress: initialPlace?.formattedAddress || `${defaultLat.toFixed(4)}, ${defaultLng.toFixed(4)}`,
    lat: defaultLat,
    lon: defaultLng,
    city: initialPlace?.city || '',
    country: initialPlace?.country || '',
    code: initialPlace?.code || 'LOC',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    { name: string; address: string; lat: number; lon: number; city: string; country: string }[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reverse geocode lat/lon to friendly address using OpenStreetMap Nominatim with Google Maps fallback
  const reverseGeocode = async (lat: number, lon: number): Promise<PlaceResult> => {
    setIsResolvingAddress(true);
    setErrorMessage(null);

    // 1. Try Google Maps Geocoder if loaded in window
    if (typeof window !== 'undefined' && (window as any).google?.maps?.Geocoder) {
      try {
        const geocoder = new (window as any).google.maps.Geocoder();
        const googleResult: any = await new Promise((resolve) => {
          geocoder.geocode({ location: { lat, lng: lon } }, (results: any[], status: any) => {
            if (status === 'OK' && results && results[0]) {
              resolve(results[0]);
            } else {
              resolve(null);
            }
          });
        });

        if (googleResult) {
          let city = '';
          let country = '';
          for (const comp of googleResult.address_components || []) {
            if (comp.types.includes('locality') || comp.types.includes('postal_town')) {
              city = comp.long_name;
            }
            if (comp.types.includes('country')) {
              country = comp.long_name;
            }
          }
          const primaryName = googleResult.formatted_address.split(',')[0] || googleResult.formatted_address;
          return {
            name: primaryName,
            formattedAddress: googleResult.formatted_address,
            lat,
            lon,
            city: city || primaryName,
            country: country || 'Global',
            code: deriveCodeFromPlace(primaryName, city),
          };
        }
      } catch (e) {
        console.warn('Google reverse geocoding fallback:', e);
      }
    }

    // 2. OpenStreetMap Nominatim reverse geocoding
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
        {
          headers: {
            'Accept-Language': 'en',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const address = data.address || {};
        const primary =
          address.suburb ||
          address.neighbourhood ||
          address.city_district ||
          address.town ||
          address.city ||
          address.village ||
          address.road ||
          data.name ||
          'Selected Location';
        const city = address.city || address.town || address.village || address.state_district || address.state || '';
        const country = address.country || '';
        const formatted = data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

        return {
          name: primary,
          formattedAddress: formatted,
          lat,
          lon,
          city: city || primary,
          country: country || 'Global',
          code: deriveCodeFromPlace(primary, city),
        };
      }
    } catch (e) {
      console.warn('Nominatim reverse geocode error:', e);
    }

    // 3. Fallback to coordinate representation
    return {
      name: `Location (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
      formattedAddress: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      lat,
      lon,
      city: 'Selected Point',
      country: '',
      code: 'MAP',
    };
  };

  // Update marker position on map
  const setMarkerPosition = (lat: number, lng: number) => {
    if (!mapRef.current) return;

    if (!markerRef.current) {
      const icon = createMapPinIcon(type === 'destination');
      const marker = L.marker([lat, lng], {
        icon,
        draggable: true,
      }).addTo(mapRef.current);

      marker.on('dragend', async () => {
        const pos = marker.getLatLng();
        const place = await reverseGeocode(pos.lat, pos.lng);
        setIsResolvingAddress(false);
        setSelectedLocation(place);
      });

      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }
  };

  // Initialize Leaflet Map when Modal is Open
  useEffect(() => {
    if (!isOpen) return;

    // Reset initial state from props
    const curLat = initialPlace?.lat && !isNaN(initialPlace.lat) ? initialPlace.lat : 19.076;
    const curLng = initialPlace?.lon && !isNaN(initialPlace.lon) ? initialPlace.lon : 72.8777;

    setSelectedLocation({
      name: initialPlace?.name || 'Selected Location',
      formattedAddress: initialPlace?.formattedAddress || `${curLat.toFixed(4)}, ${curLng.toFixed(4)}`,
      lat: curLat,
      lon: curLng,
      city: initialPlace?.city || '',
      country: initialPlace?.country || '',
      code: initialPlace?.code || 'LOC',
    });
    setErrorMessage(null);
    setSearchQuery('');
    setSearchResults([]);

    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      // Initialize map
      const map = L.map(mapContainerRef.current, {
        center: [curLat, curLng],
        zoom: initialPlace?.lat ? 13 : 7,
        zoomControl: false, // We render custom zoom buttons
      });

      // Add OpenStreetMap Tile Layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      // Set initial marker
      setMarkerPosition(curLat, curLng);

      // Handle map clicks
      map.on('click', async (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        setMarkerPosition(lat, lng);
        const place = await reverseGeocode(lat, lng);
        setIsResolvingAddress(false);
        setSelectedLocation(place);
      });

      // Invalidate size once container layout stabilizes
      map.invalidateSize();
    }, 100);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, [isOpen, initialPlace?.lat, initialPlace?.lon]);

  // Handle Search Input Change with Debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    setErrorMessage(null);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!val || val.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
            val.trim()
          )}&limit=5&addressdetails=1`,
          {
            headers: {
              'Accept-Language': 'en',
            },
          }
        );

        if (res.ok) {
          const data = await res.json();
          const items = data.map((d: any) => {
            const addr = d.address || {};
            const city = addr.city || addr.town || addr.village || addr.state || '';
            const country = addr.country || '';
            const name = d.name || d.display_name.split(',')[0];
            return {
              name,
              address: d.display_name,
              lat: parseFloat(d.lat),
              lon: parseFloat(d.lon),
              city,
              country,
            };
          });
          setSearchResults(items);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        console.warn('Location search error:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  // Select Search Item
  const handleSelectSearchItem = (item: {
    name: string;
    address: string;
    lat: number;
    lon: number;
    city: string;
    country: string;
  }) => {
    const place: PlaceResult = {
      name: item.name,
      formattedAddress: item.address,
      lat: item.lat,
      lon: item.lon,
      city: item.city || item.name,
      country: item.country || 'Global',
      code: deriveCodeFromPlace(item.name, item.city),
    };

    setSelectedLocation(place);
    setSearchResults([]);
    setSearchQuery('');

    if (mapRef.current) {
      mapRef.current.flyTo([item.lat, item.lon], 14, { duration: 1 });
      setMarkerPosition(item.lat, item.lon);
    }
  };

  // Browser Geolocation: "Use My Current Location"
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setErrorMessage('Geolocation is not supported by your browser.');
      return;
    }

    setIsGeolocating(true);
    setErrorMessage(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        if (mapRef.current) {
          mapRef.current.flyTo([lat, lon], 14, { duration: 1 });
          setMarkerPosition(lat, lon);
        }

        const place = await reverseGeocode(lat, lon);
        setIsResolvingAddress(false);
        setSelectedLocation(place);
        setIsGeolocating(false);
      },
      (err) => {
        setIsGeolocating(false);
        let msg = 'Could not retrieve your location.';
        if (err.code === err.PERMISSION_DENIED) {
          msg = 'Location permission was denied. You can still search or click anywhere on the map.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'Location information is currently unavailable.';
        } else if (err.code === err.TIMEOUT) {
          msg = 'Location request timed out. Please try clicking on the map.';
        }
        setErrorMessage(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  };

  // Zoom helpers
  const handleZoomIn = () => {
    if (mapRef.current) mapRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapRef.current) mapRef.current.zoomOut();
  };

  // Confirm Selection
  const handleConfirm = () => {
    if (!selectedLocation) return;
    onConfirm(selectedLocation);
    onClose();
  };

  if (!isOpen) return null;

  const isDest = type === 'destination';
  const themeColor = isDest ? 'emerald' : 'blue';

  return (
    <div
      id="location-picker-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="location-picker-dialog"
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-xs ${
                isDest ? 'bg-emerald-600' : 'bg-blue-600'
              }`}
            >
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">{title}</h3>
              <p className="text-[11px] text-slate-500">
                Click map to place pin, search an address, or use your current GPS location
              </p>
            </div>
          </div>
          <button
            id="close-location-modal-btn"
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Quick Actions Bar */}
        <div className="p-3.5 bg-white border-b border-slate-100 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Search location bar */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="map-location-search-input"
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search city, station, airport, or landmark worldwide..."
                className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all"
              />
              {isSearching && (
                <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
              )}
              {searchQuery && !isSearching && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Autocomplete dropdown inside modal */}
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden max-h-52 overflow-y-auto">
                  <div className="px-3 py-1 bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400">
                    Location Suggestions
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {searchResults.map((item, idx) => (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => handleSelectSearchItem(item)}
                          className="w-full text-left px-3.5 py-2 hover:bg-slate-50 flex items-start gap-2 text-xs transition-colors"
                        >
                          <Navigation className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                          <div className="overflow-hidden">
                            <span className="font-semibold text-slate-800 block truncate">{item.name}</span>
                            <span className="text-[11px] text-slate-500 block truncate">{item.address}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* "Use My Current Location" button */}
            <button
              id="use-current-location-btn"
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={isGeolocating}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 shadow-2xs transition-colors shrink-0 disabled:opacity-60"
            >
              {isGeolocating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
              ) : (
                <LocateFixed className="w-3.5 h-3.5 text-slate-600" />
              )}
              <span>{isGeolocating ? 'Detecting GPS...' : 'Use My Current Location'}</span>
            </button>
          </div>

          {/* Error message alert */}
          {errorMessage && (
            <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-800 text-[11px] animate-in fade-in duration-150">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
              <span className="flex-1">{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-amber-600 hover:text-amber-800 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Map Canvas Area */}
        <div className="relative flex-1 w-full bg-slate-100 min-h-[300px] h-[340px] sm:h-[380px] md:h-[420px]">
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-10" />

          {/* Custom Floating Zoom & Reset HUD */}
          <div className="absolute top-3 right-3 z-20 flex flex-col bg-white/95 backdrop-blur-md rounded-xl border border-slate-200 shadow-md overflow-hidden">
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-2 hover:bg-slate-100 text-slate-700 transition-colors border-b border-slate-100"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-2 hover:bg-slate-100 text-slate-700 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
          </div>

          {/* Instruction Pill */}
          <div className="absolute top-3 left-3 z-20 bg-slate-900/80 text-white backdrop-blur-md px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 shadow-sm pointer-events-none">
            <MapPin className="w-3 h-3 text-emerald-400" />
            <span>Click anywhere to select location</span>
          </div>
        </div>

        {/* Selected Location Card & Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Selected Location:
              </span>
              {isResolvingAddress && (
                <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> Resolving address...
                </span>
              )}
            </div>
            <div className="text-xs font-bold text-slate-900 truncate mt-0.5">
              {selectedLocation.name}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {selectedLocation.formattedAddress}
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
              GPS: {selectedLocation.lat.toFixed(5)}, {selectedLocation.lon.toFixed(5)}
              {selectedLocation.code ? ` • Code: ${selectedLocation.code}` : ''}
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              id="cancel-location-btn"
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              id="confirm-location-btn"
              type="button"
              onClick={handleConfirm}
              className={`inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-white text-xs font-bold shadow-xs hover:shadow transition-all ${
                isDest
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>Confirm Location</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
