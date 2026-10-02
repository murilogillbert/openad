# Quickstart: MDM APK Distribution & Updates

## Goal

Validate the end-to-end workflow:

1. Publish a new release in the management panel.
2. Provision a freshly reset device via QR into Device Owner mode and install the app.
3. Confirm the device reports its installed version.
4. Publish a newer release and confirm silent update via daily check or remote command.

## Prerequisites

- Access to a management-panel Superadmin account.
- A test Android device that can be factory reset.
- Device has connectivity (Wi‑Fi or cellular).

## Smoke test checklist

- **Install/Provision**: QR provisioning completes; device owner is set; app launches.
- **Kiosk**: app can enter kiosk/lock-task mode after provisioning.
- **Version reporting**: management panel shows installed version for the device.
- **Update**: newer approved release is detected and installed silently.
- **Rollback safety**: failed download or invalid artifact does not brick the device.

