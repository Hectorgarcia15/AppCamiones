export const formatearUltimaSenal = (fechaIso: string | null | undefined) => {
  if (!fechaIso) return "Sin señal";
  const fecha = new Date(fechaIso).getTime();
  if (Number.isNaN(fecha)) return "Sin señal";

  const segundos = Math.floor((Date.now() - fecha) / 1000);
  if (segundos < 60) return "Hace instantes";

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `Hace ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Hace ${horas} h`;

  const dias = Math.floor(horas / 24);
  return `Hace ${dias} d`;
};
