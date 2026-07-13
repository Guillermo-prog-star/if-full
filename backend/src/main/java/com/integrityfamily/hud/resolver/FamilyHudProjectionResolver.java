package com.integrityfamily.hud.resolver;

import com.integrityfamily.dto.home.FamilyHomeView;
import com.integrityfamily.dto.home.ActiveHomeView;
import com.integrityfamily.familyhome.application.FamilyHomeProjectionService;
import com.integrityfamily.familyhome.application.ProjectionRequestContext;
import com.integrityfamily.hud.dto.FamilyHudView;
import com.integrityfamily.hud.dto.HudType;
import com.integrityfamily.hud.policy.FamilyPresentationPolicy;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class FamilyHudProjectionResolver {

    private final FamilyHomeProjectionService familyHomeService;

    public FamilyHudProjectionResolver(FamilyHomeProjectionService familyHomeService) {
        this.familyHomeService = familyHomeService;
    }

    public FamilyHudView resolve(UUID familyId, UUID authenticatedUserId, ProjectionRequestContext requestContext) {
        FamilyHomeView homeView = familyHomeService.project(familyId, authenticatedUserId, requestContext);

        List<String> navigation = List.of("Hoy", "Crecemos", "Recordamos", "Somos", "Conversamos");

        // Map presentation policy data for family HUD
        String statusMessage = FamilyPresentationPolicy.formatICaF(63); 
        String paceMessage = FamilyPresentationPolicy.formatAdaptiveCapacity(0.61);
        String communicationMessage = FamilyPresentationPolicy.formatRisk("MEDIUM");

        if (homeView instanceof ActiveHomeView activeView) {
            return new FamilyHudView(
                "1.0.0-AdaptiveHUD",
                HudType.FAMILY,
                homeView.viewer(),
                familyId,
                navigation,
                statusMessage,
                paceMessage,
                communicationMessage,
                activeView.today(),
                activeView.activeSprint(),
                activeView.dimensions(),
                homeView.safetyPresentation(),
                homeView.responseMetadata()
            );
        }

        // Fallback for onboarding/other views mapped to family layout
        return new FamilyHudView(
            "1.0.0-AdaptiveHUD",
            HudType.FAMILY,
            homeView.viewer(),
            familyId,
            navigation,
            statusMessage,
            paceMessage,
            communicationMessage,
            null,
            null,
            Map.of(),
            homeView.safetyPresentation(),
            homeView.responseMetadata()
        );
    }
}
