import type { FleetStatusItem } from '@openad/api-contracts';
import type { FleetStatusDocument } from '../vehicles/fleet-status.schema';

export function fleetDocumentToItem(doc: FleetStatusDocument): FleetStatusItem {
  const loc = doc.location;
  return {
    deviceId: doc.deviceId,
    vehicleId: doc.vehicleId,
    reportedAt: doc.reportedAt.toISOString(),
    location: {
      lng: loc.coordinates[0],
      lat: loc.coordinates[1],
    },
    connectivity: doc.connectivity,
    playback: doc.playback,
    alertFlags: doc.alertFlags ?? [],
  };
}
