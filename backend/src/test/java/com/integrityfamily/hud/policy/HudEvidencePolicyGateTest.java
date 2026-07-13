package com.integrityfamily.hud.policy;

import org.junit.jupiter.api.Test;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

public class HudEvidencePolicyGateTest {

    @Test
    public void testIsAllowedForFamily() {
        assertTrue(HudEvidencePolicyGate.isAllowedForFamily("FAMILY_APPROVED"));
        assertTrue(HudEvidencePolicyGate.isAllowedForFamily("SHARED_APPROVED"));
        assertFalse(HudEvidencePolicyGate.isAllowedForFamily("PROFESSIONAL_APPROVED"));
        assertFalse(HudEvidencePolicyGate.isAllowedForFamily("SHADOW_ONLY"));
        assertFalse(HudEvidencePolicyGate.isAllowedForFamily(null));
    }

    @Test
    public void testIsAllowedForProfessional() {
        assertTrue(HudEvidencePolicyGate.isAllowedForProfessional("FAMILY_APPROVED", Set.of()));
        assertTrue(HudEvidencePolicyGate.isAllowedForProfessional("PROFESSIONAL_APPROVED", Set.of()));
        
        // Shadow only requires specific permissions
        assertFalse(HudEvidencePolicyGate.isAllowedForProfessional("SHADOW_ONLY", Set.of()));
        assertTrue(HudEvidencePolicyGate.isAllowedForProfessional("SHADOW_ONLY", Set.of("VIEW_RESEARCH_DATA")));

        // Restricted requires specific permissions
        assertFalse(HudEvidencePolicyGate.isAllowedForProfessional("RESTRICTED", Set.of()));
        assertTrue(HudEvidencePolicyGate.isAllowedForProfessional("RESTRICTED", Set.of("VIEW_RESTRICTED_EVIDENCE")));
    }
}
