import { Injectable } from '@angular/core';
import QRCode from 'qrcode';

const DEFAULT_COMPONENT =
  'com.openad/com.openad.OpenAdDeviceAdminReceiver';

/**
 * Builds Android managed-provisioning QR payload (JSON string) for Device Owner enrollment.
 * Signature checksum must match the uploaded APK signing cert in production.
 */
@Injectable({ providedIn: 'root' })
export class ProvisioningQrService {
  buildProvisioningPayload(params: {
    apkDownloadUrl: string;
    /** Base64-encoded SHA-256 of the DER signing cert (optional for dev). */
    signatureChecksumBase64?: string;
    componentName?: string;
  }): Record<string, unknown> {
    const component =
      params.componentName?.trim() || DEFAULT_COMPONENT;
    const payload: Record<string, unknown> = {
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': component,
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION':
        params.apkDownloadUrl,
      'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
    };
    if (params.signatureChecksumBase64?.trim()) {
      payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'] =
        params.signatureChecksumBase64.trim();
    }
    return payload;
  }

  async toQrDataUrl(jsonPayload: Record<string, unknown>): Promise<string> {
    const text = JSON.stringify(jsonPayload);
    return QRCode.toDataURL(text, { width: 320, margin: 2 });
  }
}
