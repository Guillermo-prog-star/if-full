package com.integrityfamily.familyhome.adapter;

import com.integrityfamily.domain.Family;
import com.integrityfamily.domain.FamilyMember;
import com.integrityfamily.domain.User;
import com.integrityfamily.domain.repository.FamilyRepository;
import com.integrityfamily.domain.repository.MemberRepository;
import com.integrityfamily.domain.repository.UserRepository;
import com.integrityfamily.dto.home.ViewerRole;
import com.integrityfamily.familyhome.port.FamilyMembershipQueryPort;
import com.integrityfamily.familyhome.security.FamilyIdentifierBridge;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Mismo criterio de acceso que {@code SecurityValidator.validateFamilyOwnership}:
 * ADMIN (bypass), creador de la familia, o miembro activo registrado.
 */
@Component
public class FamilyMembershipQueryPortAdapter implements FamilyMembershipQueryPort {

    private static final int MINOR_AGE_THRESHOLD = 18;

    private final FamilyRepository familyRepository;
    private final MemberRepository memberRepository;
    private final UserRepository userRepository;
    private final FamilyIdentifierBridge idBridge;

    public FamilyMembershipQueryPortAdapter(
            FamilyRepository familyRepository,
            MemberRepository memberRepository,
            UserRepository userRepository,
            FamilyIdentifierBridge idBridge) {
        this.familyRepository = familyRepository;
        this.memberRepository = memberRepository;
        this.userRepository = userRepository;
        this.idBridge = idBridge;
    }

    @Override
    public boolean isMember(UUID familyId, UUID userId) {
        Optional<Long> fId = idBridge.resolveFamilyId(familyId);
        Optional<Long> uId = idBridge.resolveUserId(userId);
        if (fId.isEmpty() || uId.isEmpty()) {
            return false;
        }

        User user = userRepository.findById(uId.get()).orElse(null);
        if (user == null) {
            return false;
        }
        if (isAdmin(user)) {
            return true;
        }

        Family family = familyRepository.findById(fId.get()).orElse(null);
        if (family == null) {
            return false;
        }
        if (family.getCreatedBy() != null && family.getCreatedBy().getEmail().equalsIgnoreCase(user.getEmail())) {
            return true;
        }

        return activeMemberOf(family.getId(), user).isPresent();
    }

    @Override
    public ViewerRole getRole(UUID familyId, UUID userId) {
        Optional<Long> fId = idBridge.resolveFamilyId(familyId);
        Optional<Long> uId = idBridge.resolveUserId(userId);
        if (fId.isEmpty() || uId.isEmpty()) {
            return ViewerRole.ADULT_MEMBER;
        }

        User user = userRepository.findById(uId.get()).orElse(null);
        if (user == null) {
            return ViewerRole.ADULT_MEMBER;
        }

        return activeMemberOf(fId.get(), user)
                .filter(member -> member.getAge() != null && member.getAge() < MINOR_AGE_THRESHOLD)
                .map(member -> ViewerRole.YOUNG_MEMBER)
                .orElse(ViewerRole.ADULT_MEMBER);
    }

    @Override
    public List<String> getPermissions(UUID familyId, UUID userId) {
        Optional<Long> fId = idBridge.resolveFamilyId(familyId);
        Optional<Long> uId = idBridge.resolveUserId(userId);
        if (fId.isEmpty() || uId.isEmpty()) {
            return List.of();
        }

        User user = userRepository.findById(uId.get()).orElse(null);
        if (user == null) {
            return List.of();
        }
        if (isAdmin(user)) {
            return List.of("READ", "WRITE");
        }

        Family family = familyRepository.findById(fId.get()).orElse(null);
        if (family != null && family.getCreatedBy() != null
                && family.getCreatedBy().getEmail().equalsIgnoreCase(user.getEmail())) {
            return List.of("READ", "WRITE");
        }

        return List.of("READ");
    }

    private Optional<FamilyMember> activeMemberOf(Long familyId, User user) {
        return memberRepository.findByEmail(user.getEmail())
                .filter(member -> member.isActive()
                        && member.getFamily() != null
                        && familyId.equals(member.getFamily().getId()));
    }

    private boolean isAdmin(User user) {
        return user.getRoles() != null
                && user.getRoles().stream().anyMatch(role -> "ROLE_ADMIN".equals(role.getName()));
    }
}
