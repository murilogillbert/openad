import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CreateCampaignRequest,
  CreateScheduleRuleRequest,
  CampaignStatusPatch,
} from '@openad/api-contracts';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CampaignRow {
  campaignId: string;
  name: string;
  advertiserName: string;
  status: string;
  priority: number;
  scheduledStart: string;
  scheduledEnd: string;
}

export interface GeoZoneRow {
  zoneId: string;
  name: string;
  city: string;
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | {
        type: 'Circle';
        center: { lng: number; lat: number };
        radiusMeters: number;
      };
  tier?: 'T1' | 'T2' | 'T3' | 'T4';
  priorityScore?: number;
  bindings?: Array<{
    mediaId: string;
    triggerMode: 'entry' | 'dwell';
    dwellSeconds?: number;
    retriggerCooldownSeconds: number;
    rotationMode: 'sequential' | 'weighted_random' | 'priority_first';
  }>;
}

@Injectable({ providedIn: 'root' })
export class CampaignsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  listCampaigns(page = 1, limit = 50): Observable<{
    data: CampaignRow[];
    pagination: { total: number; page: number; limit: number };
  }> {
    return this.http.get(`${this.base}/campaigns`, {
      params: { page: String(page), limit: String(limit) },
    }) as Observable<{
      data: CampaignRow[];
      pagination: { total: number; page: number; limit: number };
    }>;
  }

  createCampaign(body: CreateCampaignRequest): Observable<{ campaignId: string }> {
    return this.http.post<{ campaignId: string }>(
      `${this.base}/campaigns`,
      body
    );
  }

  uploadAsset(
    campaignId: string,
    file: File,
    mimeType: string
  ): Observable<{ assetId: string; status: string }> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mimeType', mimeType);
    return this.http.post<{ assetId: string; status: string }>(
      `${this.base}/campaigns/${campaignId}/assets`,
      fd
    );
  }

  createRule(
    campaignId: string,
    body: CreateScheduleRuleRequest
  ): Observable<{ ruleId: string }> {
    return this.http.post<{ ruleId: string }>(
      `${this.base}/campaigns/${campaignId}/rules`,
      body
    );
  }

  patchCampaignStatus(
    campaignId: string,
    body: CampaignStatusPatch
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/campaigns/${campaignId}/status`, body);
  }

  listGeoZones(city?: string): Observable<{
    data: GeoZoneRow[];
    pagination: { total: number; page: number; limit: number };
  }> {
    return this.http.get(`${this.base}/geo-zones`, {
      params: city ? { city, limit: '200' } : { limit: '200' },
    }) as Observable<{
      data: GeoZoneRow[];
      pagination: { total: number; page: number; limit: number };
    }>;
  }

  createGeoZone(body: {
    name: string;
    description: string;
    city: string;
    geometry:
      | { type: 'Polygon'; coordinates: number[][][] }
      | {
          type: 'Circle';
          center: { lng: number; lat: number };
          radiusMeters: number;
        };
    tags: string[];
    tier?: 'T1' | 'T2' | 'T3' | 'T4';
    priorityScore?: number;
    bufferExitMeters?: number;
    isActive?: boolean;
    bindings?: Array<{
      mediaId: string;
      triggerMode: 'entry' | 'dwell';
      dwellSeconds?: number;
      retriggerCooldownSeconds: number;
      rotationMode: 'sequential' | 'weighted_random' | 'priority_first';
    }>;
  }): Observable<{ zoneId: string }> {
    return this.http.post<{ zoneId: string }>(`${this.base}/geo-zones`, body);
  }

  patchGeoZone(zoneId: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.patch(`${this.base}/geo-zones/${zoneId}`, body);
  }
}
