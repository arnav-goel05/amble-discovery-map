export function eventLocationLabel(
  event = {},
  { includeDefault = false } = {},
) {
  const subtype =
    event.offMapSubtype ||
    event.venueOccurrences?.find((occurrence) => occurrence?.offMapSubtype)
      ?.offMapSubtype;
  if (
    subtype === "multiple_locations" ||
    (event.venueOccurrences?.length ?? 0) > 1
  )
    return "Multiple locations";
  if (subtype === "secret_tba") return "Mystery Location";
  if (subtype === "mobile_route") return "Mobile route";
  if (subtype === "broad_area") return "Broad area";
  return includeDefault ? "Single location" : "";
}
