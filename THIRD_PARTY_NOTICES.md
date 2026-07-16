# Third-party notices

Amble combines original application code with third-party software, map imagery, and public-sector data. Each third-party component remains subject to its own licence and terms.

## OneMap and Singapore Land Authority data

Contains information from OneMap building and mapping datasets, accessed in July 2026 from [OneMap](https://www.onemap.gov.sg/), which is made available under the [Singapore Open Data Licence version 1.0](https://www.onemap.gov.sg/legal/opendatalicence.html) and the applicable [OneMap API Terms of Service](https://www.onemap.gov.sg/legal/apitermsofservice.html).

The repository does not redistribute the large OneMap-derived `.b3dm` runtime geometry. Those assets are stored separately and should not be republished until the applicable source and dataset terms have been confirmed.

## Basemap

The application uses CARTO basemap tiles with OpenStreetMap data. Runtime attribution links to:

- [OpenStreetMap copyright and licence](https://www.openstreetmap.org/copyright)
- [CARTO attribution](https://carto.com/attributions)

## Open-source packages

JavaScript package names and resolved versions are recorded in `package-lock.json`. Their licence texts and notices are distributed with the packages installed by `npm ci` and remain governed by their respective maintainers.

The Draco decoder files under `public/draco/` originate from Google's Draco/Cesium-compatible distribution and remain governed by their upstream licence terms.

