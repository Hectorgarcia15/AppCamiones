import * as Location from "expo-location";

// En Android la geocodificacion inversa exige permiso de ubicacion. Lo pedimos
// una sola vez por sesion: si el usuario lo niega, la app sigue sin direccion.
let permisoConcedido: boolean | null = null;

// Evita repetir la consulta para el mismo punto (4 decimales ~ 11 m)
const cache = new Map<string, string | null>();

// Se combinan dos fuentes, cada una para lo que hace bien:
// - Nominatim (OpenStreetMap) con zoom=17 da la CALLE por la que pasa el punto.
//   El geocodificador de Android da la casa con numero mas cercana, que cerca
//   de una esquina puede caer en la calle de al lado.
// - El geocodificador de Android da el SECTOR correcto (ej. "Enriquillo"),
//   donde Nominatim a veces devuelve un barrio vecino (ej. "Villa Marina").
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const TIMEOUT_NOMINATIM_MS = 8000;

type PartesOSM = { calle: string; zona: string | null };

async function tienePermiso() {
  if (permisoConcedido === null) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    permisoConcedido = status === "granted";
  }
  return permisoConcedido;
}

// Ej: "Calle Rubén Darío 19, Enriquillo"
function formatearDireccion(resultado: Location.LocationGeocodedAddress) {
  const calle = [resultado.street, resultado.streetNumber].filter(Boolean).join(" ");
  const zona = resultado.district || resultado.city || resultado.subregion || resultado.region;
  const partes = [calle, zona].filter(Boolean);
  if (partes.length > 0) return partes.join(", ");
  return resultado.formattedAddress || resultado.name || null;
}

async function consultarNominatim(latitud: number, longitud: number): Promise<PartesOSM | null> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_NOMINATIM_MS);
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${latitud}&lon=${longitud}&zoom=17&addressdetails=1&accept-language=es`;
    // Nominatim exige identificar la app en cada consulta
    const res = await fetch(url, { headers: { "User-Agent": "HECGAR-GPS/1.0" }, signal: controlador.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data?.address;
    if (!a?.road) return null;
    const zona = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.city;
    return { calle: a.road, zona: zona || null };
  } catch (error: any) {
    console.log(`Nominatim no respondió: ${error?.message || error}`);
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}

async function consultarAndroid(latitud: number, longitud: number): Promise<Location.LocationGeocodedAddress | null> {
  try {
    if (!(await tienePermiso())) return null;
    const resultados = await Location.reverseGeocodeAsync({ latitude: latitud, longitude: longitud });
    return resultados[0] ?? null;
  } catch (error: any) {
    console.log(`No se pudo obtener la dirección: ${error?.message || error}`);
    return null;
  }
}

// Ej: "Calle Rubén Darío, Enriquillo" (calle de OSM + sector de Android)
export async function obtenerDireccion(latitud: number, longitud: number): Promise<string | null> {
  const clave = `${latitud.toFixed(4)},${longitud.toFixed(4)}`;
  if (cache.has(clave)) return cache.get(clave) ?? null;

  // Las dos consultas van en paralelo: se espera solo a la mas lenta
  const [osm, android] = await Promise.all([
    consultarNominatim(latitud, longitud),
    consultarAndroid(latitud, longitud),
  ]);

  let direccion: string | null = null;
  if (osm) {
    // Solo "district" de Android: "city" seria "Santo Domingo", peor que la zona de OSM
    const sector = android?.district || osm.zona;
    direccion = [osm.calle, sector].filter(Boolean).join(", ");
  } else if (android) {
    // Sin OSM se muestra lo de Android completo, como antes del cambio
    direccion = formatearDireccion(android);
  }

  // Solo se guarda si hubo respuesta, para que un fallo de red no quede pegado
  if (direccion) cache.set(clave, direccion);
  return direccion;
}

export function distanciaMetros(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const rad = (grados: number) => (grados * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
