# IFA-HUD Data Classification & Governance

This document establishes the official data classification levels, access rules, and governance policies for all metrics and narrative fields exposed via the IFA-HUD.

## 1. Data Classification Levels

To ensure patient/client confidentiality and comply with HIPAA/GDPR clinical research requirements, data points are classified into three strict tiers:

### Tier 1: PUBLIC / SHARED
- **Definition**: General metadata containing no clinical assessments, metrics, or personal health records.
- **Allowed Elements**: Family Display Name, Member Roles, Journey Stage (e.g., ONBOARDING, ENGAGED).
- **HUD Exposure**: Allowed on all HUD contexts (Family and Professional).

### Tier 2: CLINICAL / PROFESSIONAL
- **Definition**: Granular relational indicators, clinical assessment indicators, and professional logs.
- **Allowed Elements**: ICaF score, clinical capacity indicators, therapist logs, and intervention recommendations.
- **HUD Exposure**: STRICTLY restricted to the Professional HUD. Excluded from the Family HUD at the serialization level.

### Tier 3: RESEARCH & SHADOW (SHADOW_ONLY)
- **Definition**: Experimental psychological models, raw safety signals, and unvalidated pilot data.
- **Allowed Elements**: Unverified safety triggers, experimental telemetry.
- **HUD Exposure**: Hidden by default from both family and professional HUDs. Exposed only under explicit research context flags.

## 2. Policy Enforcement & Auditing

- **Access Policy**: The `HudEvidencePolicyGate` enforces runtime validation, rejecting elements tagged with `SHADOW_ONLY` from serializing into family schemas.
- **Auditing**: Internal telemetry registers errors as distinct states (`HUD_RESOURCE_NOT_FOUND`, `HUD_RESOURCE_CONCEALED`) for log analysis, while returning a uniform public `404 NOT_FOUND` layout to the API caller to mitigate enumeration attacks.
