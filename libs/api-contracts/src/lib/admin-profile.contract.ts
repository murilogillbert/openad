import type { UserRole } from '@openad/domain';

/** GET /api/v1/admin/me */
export interface AdminMeResponse {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  contactEmail: string | null;
  contactPhone: string | null;
  photoUrl: string | null;
}

/** PATCH /api/v1/admin/me */
export interface AdminMePatchRequest {
  displayName?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Upload handled separately; this toggles clearing photo if supported. */
  clearPhoto?: boolean;
}

/** POST /api/v1/admin/me/change-password */
export interface AdminChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** GET /api/v1/admin/me/sessions */
export interface AdminSessionListItem {
  sessionId: string;
  label: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

export interface AdminSessionsListResponse {
  items: AdminSessionListItem[];
}

/** POST /api/v1/admin/me/sessions/revoke-others */
export interface AdminRevokeOtherSessionsResponse {
  revokedCount: number;
}

