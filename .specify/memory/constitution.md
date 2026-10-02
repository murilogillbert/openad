<!--
SYNC IMPACT REPORT
==================
Version change: 0.0.0 (template) → 1.0.0
Rationale: MAJOR bump — first concrete population of the constitution from the blank template.
           All principle slots were placeholders with no prior governance semantics.

Modified Principles:
  [PRINCIPLE_1_NAME] → I. Keep It Simple (KISS)
  [PRINCIPLE_2_NAME] → II. Don't Repeat Yourself (DRY)
  [PRINCIPLE_3_NAME] → III. SOLID Design
  [PRINCIPLE_4_NAME] → IV. You Aren't Gonna Need It (YAGNI)
  [PRINCIPLE_5_NAME] → V. Tell, Don't Ask (TDA)
  (three additional principles added beyond template default of 5)
  Added: VI. Test-Driven Development (TDD)
  Added: VII. Enterprise-Level Code Quality
  Added: VIII. Clean Code

Added Sections:
  - "Development Standards" (Section 2) — coding standards and practices gate
  - "Quality Gates" (Section 3) — CI/CD and review gates

Removed Sections: none

Templates Requiring Updates:
  ✅ .specify/templates/plan-template.md — Constitution Check gates updated (see notes)
  ✅ .specify/templates/spec-template.md — no structural changes required; principle-compatible
  ✅ .specify/templates/tasks-template.md — test-first notes already aligned with TDD principle
  ⚠  .specify/templates/commands/ — no commands/ subdirectory found; no action required

Follow-up TODOs:
  TODO(RATIFICATION_DATE): Project has no commits or README yet — date set to first
    constitution authoring date (2026-04-03). Confirm when the project formally adopts this.
  TODO(PROJECT_NAME): No project name found in repository. Defaulted to "OpenAD".
    Update when official project name is confirmed.
-->

# OpenAD Constitution

## Core Principles

### I. Keep It Simple (KISS)

Every design decision MUST favour the simplest correct solution.
Complexity MUST be explicitly justified — if a simpler alternative exists,
it MUST be used. Abstractions are introduced only when they remove
demonstrated, real duplication or enforce a clear architectural boundary.
Premature generalisation is prohibited.

**Rationale**: Simplicity reduces cognitive load, defect rates, and onboarding
time. Complexity that is not essential is a liability, not an asset.

### II. Don't Repeat Yourself (DRY)

Every piece of knowledge or logic MUST have a single, authoritative
representation in the codebase. Duplication of behaviour across modules
MUST be eliminated by extracting shared abstractions (functions, classes,
services, or configuration). Copy-paste programming is prohibited.

**Rationale**: Duplicated logic means duplicated defects and is a maintenance
hazard. A single source of truth ensures that changes propagate correctly
and completely.

### III. SOLID Design

All object-oriented and module-level design MUST adhere to the five SOLID
principles:

- **S** — Single Responsibility: every class/module MUST have exactly one
  reason to change.
- **O** — Open/Closed: entities MUST be open for extension and closed for
  modification.
- **L** — Liskov Substitution: subtypes MUST be substitutable for their
  base types without altering correctness.
- **I** — Interface Segregation: clients MUST NOT be forced to depend on
  interfaces they do not use.
- **D** — Dependency Inversion: high-level modules MUST NOT depend on
  low-level modules; both MUST depend on abstractions.

**Rationale**: SOLID produces systems that are extensible, testable, and
resilient to change without requiring rewrites.

### IV. You Aren't Gonna Need It (YAGNI)

Functionality MUST NOT be implemented until it is concretely required by a
current user story or requirement. Speculative features, future-proofing
without need, and unused code paths are prohibited. Every line of code
MUST be traceable to an active requirement.

**Rationale**: Unused code carries maintenance cost and testing debt without
delivering value. YAGNI keeps the codebase lean and focused.

### V. Tell, Don't Ask (TDA)

Objects and modules MUST be told what to do, not asked for their internal
state to make a decision elsewhere. Decision logic MUST live with the data
it operates on. Anemic domain models and external state inspection
(feature envy) are prohibited.

**Rationale**: TDA enforces high cohesion and low coupling. Behaviour
co-located with data is easier to test, change, and reason about.

### VI. Test-Driven Development (TDD) *(NON-NEGOTIABLE)*

Tests MUST be written before the implementation code they verify.
The Red-Green-Refactor cycle is strictly enforced:

1. **Red** — write a failing test that defines desired behaviour.
2. **Green** — write the minimum implementation to make the test pass.
3. **Refactor** — clean up without breaking tests.

All new features and bug fixes MUST be covered by tests before the
implementation is merged. Tests MUST be independently runnable and
deterministic.

**Rationale**: TDD produces higher-quality, better-designed code and
provides a living specification of system behaviour.

### VII. Enterprise-Level Code Quality

All code MUST meet enterprise production standards:

- Structured, context-rich logging MUST be implemented for all significant
  operations and error paths.
- Errors MUST be handled explicitly; swallowing exceptions is prohibited.
- Public APIs MUST be versioned and backward-compatible according to
  semantic versioning (MAJOR.MINOR.PATCH).
- Security MUST be considered at the design stage for every feature
  (input validation, least privilege, secrets management).
- Performance goals MUST be defined per feature and validated; premature
  optimisation is prohibited but known bottlenecks MUST be addressed.
- All public interfaces MUST be documented with types, parameters,
  return values, and error conditions.

**Rationale**: Enterprise standards ensure the system is operable,
supportable, and evolvable at scale.

### VIII. Clean Code

Code MUST be written for human readers first, machines second:

- Names (variables, functions, classes, modules) MUST be intention-revealing
  and unambiguous; abbreviations and single-character names (outside of
  well-established conventions) are prohibited.
- Functions MUST do one thing only and remain short enough to comprehend
  without scrolling.
- Comments MUST explain *why*, not *what*; code that requires a comment to
  explain *what* it does MUST be refactored.
- Dead code, commented-out code, and debugging artefacts MUST NOT be
  committed.
- Code MUST pass all linting and formatting checks (enforced via CI).

**Rationale**: Clean code reduces review time, defect introduction rate,
and the cost of future changes.

## Development Standards

The following standards apply to all work in this project:

- **Language Conventions**: Follow the idiomatic style guide of the primary
  language in use. Linting and formatting are enforced automatically.
- **Dependency Management**: External dependencies MUST be explicitly
  justified. Prefer standard-library solutions. Pin dependency versions
  in lock files.
- **Branching**: Feature work happens on named branches
  (`###-kebab-case-description`). No direct commits to the default branch.
- **Commit Messages**: Conventional Commits format is REQUIRED
  (`type(scope): description`).
- **Code Review**: All changes require at least one peer review before
  merging. The reviewer MUST verify constitution compliance.

## Quality Gates

The following gates MUST pass before any feature branch is merged:

1. **Constitution Check** (plan phase): the plan MUST explicitly verify
   alignment with each of the eight core principles.
2. **All tests green**: the full test suite MUST pass with no skips.
3. **Coverage threshold**: line coverage MUST meet or exceed the
   project-configured minimum (default: 80%).
4. **Linting & formatting**: zero violations allowed.
5. **Documentation**: public API surface MUST be documented.
6. **Security review**: any feature touching auth, IO, or external services
   MUST include a security checklist entry.

## Governance

This constitution supersedes all other development practices and informal
agreements. Amendments require:

1. A written proposal describing the change and its rationale.
2. Explicit approval from the project owner or lead.
3. A version bump following the semantic versioning policy below.
4. A migration plan if existing code must be updated to comply.

**Versioning Policy**:
- MAJOR: removal or backward-incompatible redefinition of a principle.
- MINOR: addition of a new principle, section, or materially expanded
  guidance.
- PATCH: clarifications, wording improvements, or non-semantic refinements.

**Compliance Review**: Constitution compliance MUST be verified at each
pull-request review and at every quarterly project retrospective.

**Version**: 1.0.0 | **Ratified**: 2026-04-03 | **Last Amended**: 2026-04-03
