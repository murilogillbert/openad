import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DriverSummary {
  /** `public.users.id`. É o que o repasse usa. */
  userId: string;
  name: string;
  email: string;
}

export interface DeviceDriverBinding {
  deviceId: string;
  vehicleId: string | null;
  driver: DriverSummary | null;
  /** Fração do valor faturável que vai para o motorista. */
  payoutMinPercent: number;
}

/**
 * Motorista como consulta ao cadastro do ecossistema.
 *
 * O openad não guarda motorista: a fonte é `public.users` no Postgres do hub, e a API
 * apenas lê o espelho. O que o openad guarda é o vínculo, e é por isso que a operação é
 * `PUT .../driver` num aparelho, não um campo de formulário de veículo.
 */
@Injectable({ providedIn: 'root' })
export class DriversService {
  private readonly http = inject(HttpClient);

  /** Termo vazio devolve os primeiros por nome — estado inicial útil, não busca em branco. */
  search(q: string): Observable<DriverSummary[]> {
    return this.http.get<DriverSummary[]>(
      `${environment.apiBaseUrl}/admin/drivers/search`,
      { params: { q } }
    );
  }

  get(deviceId: string): Observable<DeviceDriverBinding> {
    return this.http.get<DeviceDriverBinding>(
      `${environment.apiBaseUrl}/admin/devices/${deviceId}/driver`
    );
  }

  bind(deviceId: string, driverUserId: string): Observable<DeviceDriverBinding> {
    return this.http.put<DeviceDriverBinding>(
      `${environment.apiBaseUrl}/admin/devices/${deviceId}/driver`,
      { driverUserId }
    );
  }

  unbind(deviceId: string): Observable<DeviceDriverBinding> {
    return this.http.delete<DeviceDriverBinding>(
      `${environment.apiBaseUrl}/admin/devices/${deviceId}/driver`
    );
  }
}
