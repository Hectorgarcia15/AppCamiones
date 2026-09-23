import * as Location from "expo-location";

// En Android la geocodificacion inversa exige permiso de ubicacion. Lo pedimos
// una sola vez por sesion: si el usuario lo niega, la app sigue sin direccion.
let permisoConcedido: boolean | null = null;

// Evita repetir la consulta para el mismo punto (4 decimales ~ 11 m)
const cache = new Map<string, string | null>();

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

export async function obtenerDireccion(latitud: number, longitud: number): Promise<string | null> {
  const clave = `${latitud.toFixed(4)},${longitud.toFixed(4)}`;
  if (cache.has(clave)) return cache.get(clave) ?? null;

  try {
    if (!(await tienePermiso())) return null;
    const resultados = await Location.reverseGeocodeAsync({ latitude: latitud, longitude: longitud });
    const direccion = resultados.length > 0 ? formatearDireccion(resultados[0]) : null;
    cache.set(clave, direccion);
    return direccion;
  } catch (error: any) {
    console.log(`No se pudo obtener la dirección: ${error?.message || error}`);
    return null;
  }
}

export function distanciaMetros(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const rad = (grados: number) => (grados * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
