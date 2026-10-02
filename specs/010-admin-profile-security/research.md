# Research: Admin Console — Profile, Configuration, Releases

**Date**: 2026-04-22  
**Branch**: `010-admin-profile-security`

## Decision 1: Session representation for “Active Sessions”

- **Decision**: Reuse the existing authentication/session system as the source of truth for active sessions and revocation.
- **Rationale**: Minimizes security risk and avoids inventing a parallel session model; aligns with KISS/DRY.
- **Alternatives considered**:
  - Build a new “session registry” table specifically for UI display (rejected: duplication and higher security surface area).

## Decision 2: Platform configuration source of truth

- **Decision**: Store fleet-wide configuration as a single authoritative configuration document (or equivalent single source) with audited updates; no group/device overrides in v1.
- **Rationale**: Matches clarified scope (fleet-wide only) and supports “explicit Save Changes” UX with simple draft/active semantics.
- **Alternatives considered**:
  - Multiple scopes (fleet + group + device) (rejected: out of scope; increases complexity and testing matrix).

## Decision 3: PDF cheat-sheet generation

- **Decision**: Generate a simple PDF containing the master QR code + concise 3-step instructions; avoid embedding secrets or environment-specific credentials.
- **Rationale**: Meets requirement and keeps security posture strong; simplest deliverable.
- **Alternatives considered**:
  - Include troubleshooting/support details (rejected for v1: not required and increases content governance needs).

## Open questions (to confirm during implementation)

- What exact session metadata is currently available (device label, last active) and whether any light enrichment is needed for display-only labels.
- Where existing fleet thresholds are currently validated (if they exist) so the configuration console maps cleanly onto existing behaviour.
