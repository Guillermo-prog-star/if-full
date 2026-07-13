package com.integrityfamily.hud.policy;

import java.util.Set;

public class HudEvidencePolicyGate {

    public enum EvidenceClassification {
        FAMILY_APPROVED,
        PROFESSIONAL_APPROVED,
        SHARED_APPROVED,
        RESEARCH_ONLY,
        SHADOW_ONLY,
        RESTRICTED
    }

    public static boolean isAllowedForFamily(String classification) {
        if (classification == null) {
            return false;
        }
        return "FAMILY_APPROVED".equals(classification) || "SHARED_APPROVED".equals(classification);
    }

    public static boolean isAllowedForProfessional(String classification, Set<String> viewerPermissions) {
        if (classification == null) {
            return false;
        }
        if ("SHADOW_ONLY".equals(classification) || "RESEARCH_ONLY".equals(classification)) {
            return viewerPermissions != null && viewerPermissions.contains("VIEW_RESEARCH_DATA");
        }
        if ("RESTRICTED".equals(classification)) {
            return viewerPermissions != null && viewerPermissions.contains("VIEW_RESTRICTED_EVIDENCE");
        }
        return true; // FAMILY_APPROVED, SHARED_APPROVED, PROFESSIONAL_APPROVED are allowed
    }
}
