---
name: GIS Road Mapping exports
description: Architecture decisions for the GIS Road Mapping feature and its export endpoints
---

# GIS Road Mapping — Key Decisions

## Export authentication pattern
The `/api/gis/export/geojson|kml|gpx` endpoints use `requireAnyAuth`. Browser navigation (clicking `<a href="/api/gis/...">`) does NOT send the Bearer token, so exports silently return 401.

**How to apply:** Use `triggerExportDownload()` in road-mapping.tsx — fetches with `Authorization: Bearer` header, creates a Blob URL, then clicks a programmatic `<a>` element. Any future export endpoint added to gis.ts must use the same pattern on the frontend.

**Why:** Supabase session token is in memory only; it is not a cookie, so it cannot be sent automatically by the browser on navigation.

## Route grouping key
Routes are grouped by `vehicleId:dispatchId` (when dispatch_id is set) or `vehicleId:YYYY-MM-DD` (date of first ping). A group with fewer than 2 points is skipped.

## Coordinate order in GeoJSON
GeoJSON (RFC 7946) uses [longitude, latitude] order. The `coordinates` field in route objects follows this convention. The Leaflet Polyline component reverses to [lat, lng] as required.

## Vehicle color assignment
Colors cycle from `ROUTE_COLORS` array by order of first appearance (not by vehicleId %). Same vehicle across multiple routes gets the same color because `vehicleColorIdx` is a Map keyed on vehicleId within one buildRoutes() call.
