# Quickstart: Admin Console — Profile, Configuration, Releases

This quickstart describes how a reviewer can validate the feature end-to-end in a deployed or local environment.

## 1) Profile & Security

- Open the **Profile & Security** screen.
- Update profile details and save.
- Change password (validate policy + success messaging).
- Verify **Active Sessions** lists the current session and at least one identifying label.
- If multiple sessions exist, use **Log Out of All Other Devices** and confirm only the current session remains active.

## 2) Platform Configuration Console

- Open **Platform Configuration**.
- Adjust at least one value in each card (Media, Fleet Health, Analytics).
- Confirm a **Save Changes** banner appears and nothing applies until saved.
- Click **Restore Default Settings** and confirm values reset (pending).
- Click **Save Changes** and confirm banner clears.

## 3) Device App Releases

- Open **Releases**.
- If no stable release exists, confirm the QR area shows an empty state and guidance.
- Upload a new release with release notes.
- Confirm the release appears in the ledger with correct status.
- Publish as **Latest Stable** and confirm the master QR updates.
- Download the PDF cheat-sheet and verify it contains:
  - the master QR code
  - a concise 3-step instruction block
- In vehicle monitoring for a single device, confirm **Force Update Check** is visible/usable only for super-admin.
