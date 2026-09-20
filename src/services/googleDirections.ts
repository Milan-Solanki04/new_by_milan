// Google Maps Directions & Real-World Transit Integration Service

import { loadGoogleMapsScript } from './googlePlaces';

export interface GoogleRouteResult {
  status: 'OK' | 'FALLBACK';
  distanceKm: number;
  durationMinutes: number;
  mode: 'TRANSIT' | 'DRIVING';
  summary: string;
  steps: {
    instructions: string;
    distanceKm: number;
    durationMinutes: number;
    mode: string;
    transitDetails?: {
      lineName: string;
      agencyName: string;
      departureStop: string;
      arrivalStop: string;
      headsign: string;
      numStops: number;
    };
  }[];
}

/**
 * Normalizes a Route object returned from google.maps.routes.Route.computeRoutes
 * into the application's GoogleRouteResult interface.
 */
function normalizeComputeRoute(route: any, mode: 'TRANSIT' | 'DRIVING'): GoogleRouteResult | null {
  if (!route) return null;

  const leg = route.legs?.[0];

  // Compute total distance in meters
  const distMeters =
    typeof route.distanceMeters === 'number'
      ? route.distanceMeters
      : typeof leg?.distanceMeters === 'number'
      ? leg.distanceMeters
      : typeof leg?.distance?.value === 'number'
      ? leg.distance.value
      : 0;
  const distanceKm = Math.round(distMeters / 1000);

  // Compute total duration in minutes
  let durationMinutes = 0;
  if (route.durationMillis != null) {
    durationMinutes = Math.round(Number(route.durationMillis) / 60000);
  } else if (typeof route.duration === 'string') {
    durationMinutes = Math.round(parseFloat(route.duration) / 60);
  } else if (typeof route.duration === 'number') {
    durationMinutes = Math.round(route.duration / 60);
  } else if (leg?.durationMillis != null) {
    durationMinutes = Math.round(Number(leg.durationMillis) / 60000);
  } else if (typeof leg?.duration === 'string') {
    durationMinutes = Math.round(parseFloat(leg.duration) / 60);
  } else if (typeof leg?.duration?.value === 'number') {
    durationMinutes = Math.round(leg.duration.value / 60);
  }

  // Summary / Description
  const summary =
    route.description ||
    route.summary ||
    leg?.description ||
    (mode === 'TRANSIT' ? 'Public Transit Route' : 'Regional Highway Corridor');

  // Steps
  const rawSteps = leg?.steps || route.steps || [];
  const steps = rawSteps.map((s: any) => {
    const isTransit =
      s.travelMode === 'TRANSIT' ||
      s.travel_mode === 'TRANSIT' ||
      mode === 'TRANSIT';

    const stepDistMeters =
      typeof s.distanceMeters === 'number'
        ? s.distanceMeters
        : typeof s.distance?.value === 'number'
        ? s.distance.value
        : 0;

    let stepDurMins = 0;
    if (s.durationMillis != null) {
      stepDurMins = Math.round(Number(s.durationMillis) / 60000);
    } else if (typeof s.staticDuration === 'string') {
      stepDurMins = Math.round(parseFloat(s.staticDuration) / 60);
    } else if (typeof s.duration === 'string') {
      stepDurMins = Math.round(parseFloat(s.duration) / 60);
    } else if (typeof s.duration?.value === 'number') {
      stepDurMins = Math.round(s.duration.value / 60);
    }

    const rawInstructions =
      s.navigationInstruction?.instructions ||
      s.instructions ||
      s.html_instructions ||
      s.description ||
      '';
    const instructions = rawInstructions ? rawInstructions.replace(/<[^>]*>?/gm, '') : '';

    const td = s.transitDetails || s.transit;
    const transitDetails =
      isTransit && td
        ? {
            lineName:
              td.transitLine?.name ||
              td.transitLine?.nameShort ||
              td.line?.name ||
              td.line?.short_name ||
              'Transit',
            agencyName:
              td.transitLine?.agencies?.[0]?.name ||
              td.line?.agencies?.[0]?.name ||
              'Regional Transit',
            departureStop:
              td.stopDetails?.departureStop?.name ||
              td.departure_stop?.name ||
              '',
            arrivalStop:
              td.stopDetails?.arrivalStop?.name ||
              td.arrival_stop?.name ||
              '',
            headsign: td.headsign || '',
            numStops: td.stopCount || td.num_stops || 1,
          }
        : undefined;

    return {
      instructions,
      distanceKm: Math.round(stepDistMeters / 1000),
      durationMinutes: stepDurMins,
      mode: s.travelMode || s.travel_mode || mode,
      transitDetails,
    };
  });

  return {
    status: 'OK',
    distanceKm,
    durationMinutes,
    mode,
    summary,
    steps: mode === 'DRIVING' ? steps.slice(0, 5) : steps,
  };
}

/**
 * Fetches real-world driving and transit directions using Google Maps Routes API (google.maps.routes.Route.computeRoutes)
 */
export async function fetchGoogleDirections(
  origin: { lat: number; lon: number } | string,
  destination: { lat: number; lon: number } | string
): Promise<GoogleRouteResult | null> {
  const loaded = await loadGoogleMapsScript();
  const google = (typeof window !== 'undefined' ? (window as any).google : null);

  if (!loaded || !google?.maps) {
    return null;
  }

  // Import or locate the routes library (google.maps.routes.Route)
  let RouteClass = google.maps.routes?.Route;
  if (!RouteClass && typeof google.maps.importLibrary === 'function') {
    try {
      const routesLib = await google.maps.importLibrary('routes');
      RouteClass = routesLib?.Route;
    } catch (e) {
      console.warn('Google Maps importLibrary("routes") warning:', e);
    }
  }
  if (!RouteClass) {
    RouteClass = (window as any).google?.maps?.routes?.Route;
  }

  if (!RouteClass || typeof RouteClass.computeRoutes !== 'function') {
    return null;
  }

  try {
    const originParam =
      typeof origin === 'string'
        ? origin
        : google.maps.LatLng
        ? new google.maps.LatLng(origin.lat, origin.lon)
        : { lat: origin.lat, lng: origin.lon };

    const destParam =
      typeof destination === 'string'
        ? destination
        : google.maps.LatLng
        ? new google.maps.LatLng(destination.lat, destination.lon)
        : { lat: destination.lat, lng: destination.lon };

    // 1. Try public transit first using google.maps.routes.Route.computeRoutes
    try {
      const transitResponse = await RouteClass.computeRoutes({
        origin: originParam,
        destination: destParam,
        travelMode: 'TRANSIT',
        fields: ['durationMillis', 'distanceMeters', 'description', 'legs'],
      });

      const transitRoute = transitResponse?.routes?.[0];
      if (transitRoute) {
        const parsed = normalizeComputeRoute(transitRoute, 'TRANSIT');
        if (parsed) return parsed;
      }
    } catch {
      // Transit may not exist on rural or intercity regional corridors; fall through to DRIVING
    }

    // 2. Fetch real-world road / driving directions using google.maps.routes.Route.computeRoutes
    const drivingResponse = await RouteClass.computeRoutes({
      origin: originParam,
      destination: destParam,
      travelMode: 'DRIVING',
      fields: ['durationMillis', 'distanceMeters', 'description', 'legs'],
    });

    const drivingRoute = drivingResponse?.routes?.[0];
    if (drivingRoute) {
      const parsed = normalizeComputeRoute(drivingRoute, 'DRIVING');
      if (parsed) return parsed;
    }
  } catch (err) {
    console.warn('Google Routes API computeRoutes error/fallback:', err);
  }

  return null;
}
