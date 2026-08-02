package com.integrityfamily.security;

import com.integrityfamily.domain.*;
import com.integrityfamily.domain.repository.*;
import com.integrityfamily.support.domain.AssignmentStatus;
import com.integrityfamily.support.domain.FamilySupportAssignment;
import com.integrityfamily.support.domain.SupportNetworkMember;
import com.integrityfamily.support.repository.FamilySupportAssignmentRepository;
import com.integrityfamily.support.repository.SupportNetworkMemberRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("FamilySecurityEvaluator — Unit Tests")
class FamilySecurityEvaluatorTest {

    @Mock UserRepository userRepository;
    @Mock MemberRepository memberRepository;
    @Mock EvaluationRepository evaluationRepository;
    @Mock RiskSnapshotRepository riskSnapshotRepository;
    @Mock FamilyRiskTrajectoryRepository familyRiskTrajectoryRepository;
    @Mock SupportNetworkMemberRepository supportNetworkMemberRepository;
    @Mock FamilySupportAssignmentRepository familySupportAssignmentRepository;

    @InjectMocks FamilySecurityEvaluator evaluator;

    private static final Long FAMILY_TRAJECTORY_ID = 100L;
    private static final Long FAMILY_ID = 10L;
    private static final Long GUARDIAN_MEMBER_ID = 5L;

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateAs(String email) {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(email, null, List.of()));
    }

    private User aUser(String email, String... roleNames) {
        User u = new User();
        u.setEmail(email);
        List<Role> roles = new java.util.ArrayList<>();
        for (String r : roleNames) {
            Role role = new Role();
            role.setName(r);
            roles.add(role);
        }
        u.setRoles(roles);
        return u;
    }

    private Family aFamily(Long guardianMemberId) {
        Family f = new Family();
        f.setId(FAMILY_ID);
        f.setGuardianMemberId(guardianMemberId);
        return f;
    }

    private FamilyRiskTrajectory aFamilyTrajectory(Family family) {
        FamilyRiskTrajectory frt = new FamilyRiskTrajectory();
        frt.setId(FAMILY_TRAJECTORY_ID);
        frt.setFamily(family);
        return frt;
    }

    @Nested
    @DisplayName("canCloseSafetyProtocol()")
    class CanCloseSafetyProtocol {

        @Test
        @DisplayName("false si no hay autenticación")
        void falseIfNotAuthenticated() {
            assertThat(evaluator.canCloseSafetyProtocol(FAMILY_TRAJECTORY_ID)).isFalse();
        }

        @Test
        @DisplayName("false si familyTrajectoryId es null")
        void falseIfIdIsNull() {
            authenticateAs("someone@test.com");
            assertThat(evaluator.canCloseSafetyProtocol(null)).isFalse();
        }

        @Test
        @DisplayName("true para ROLE_ADMIN sin importar guardian/profesional")
        void trueForAdmin() {
            authenticateAs("admin@test.com");
            when(userRepository.findByEmailIgnoreCase("admin@test.com"))
                    .thenReturn(Optional.of(aUser("admin@test.com", "ROLE_ADMIN")));

            assertThat(evaluator.canCloseSafetyProtocol(FAMILY_TRAJECTORY_ID)).isTrue();
        }

        @Test
        @DisplayName("true para el Guardian Familiar de la familia de la trayectoria")
        void trueForGuardian() {
            Family family = aFamily(GUARDIAN_MEMBER_ID);
            FamilyRiskTrajectory frt = aFamilyTrajectory(family);
            FamilyMember guardianMember = FamilyMember.builder().id(GUARDIAN_MEMBER_ID).family(family).email("guardian@test.com").build();

            authenticateAs("guardian@test.com");
            when(userRepository.findByEmailIgnoreCase("guardian@test.com"))
                    .thenReturn(Optional.of(aUser("guardian@test.com")));
            when(familyRiskTrajectoryRepository.findById(FAMILY_TRAJECTORY_ID)).thenReturn(Optional.of(frt));
            when(memberRepository.findByEmail("guardian@test.com")).thenReturn(Optional.of(guardianMember));

            assertThat(evaluator.canCloseSafetyProtocol(FAMILY_TRAJECTORY_ID)).isTrue();
        }

        @Test
        @DisplayName("true para profesional con FamilySupportAssignment ACTIVE en esa familia")
        void trueForActiveProfessional() {
            Family family = aFamily(GUARDIAN_MEMBER_ID);
            FamilyRiskTrajectory frt = aFamilyTrajectory(family);
            SupportNetworkMember pro = SupportNetworkMember.builder().id(7L).email("pro@test.com").build();
            FamilySupportAssignment assignment = FamilySupportAssignment.builder()
                    .familyId(FAMILY_ID).supportMember(pro).status(AssignmentStatus.ACTIVE).build();

            authenticateAs("pro@test.com");
            when(userRepository.findByEmailIgnoreCase("pro@test.com"))
                    .thenReturn(Optional.of(aUser("pro@test.com")));
            when(familyRiskTrajectoryRepository.findById(FAMILY_TRAJECTORY_ID)).thenReturn(Optional.of(frt));
            lenient().when(memberRepository.findByEmail("pro@test.com")).thenReturn(Optional.empty());
            when(supportNetworkMemberRepository.findByEmail("pro@test.com")).thenReturn(Optional.of(pro));
            when(familySupportAssignmentRepository.findByFamilyIdAndSupportMemberId(FAMILY_ID, 7L))
                    .thenReturn(Optional.of(assignment));

            assertThat(evaluator.canCloseSafetyProtocol(FAMILY_TRAJECTORY_ID)).isTrue();
        }

        @Test
        @DisplayName("false para profesional con asignacion REVOKED")
        void falseForRevokedProfessional() {
            Family family = aFamily(GUARDIAN_MEMBER_ID);
            FamilyRiskTrajectory frt = aFamilyTrajectory(family);
            SupportNetworkMember pro = SupportNetworkMember.builder().id(7L).email("pro@test.com").build();
            FamilySupportAssignment assignment = FamilySupportAssignment.builder()
                    .familyId(FAMILY_ID).supportMember(pro).status(AssignmentStatus.REVOKED).build();

            authenticateAs("pro@test.com");
            when(userRepository.findByEmailIgnoreCase("pro@test.com"))
                    .thenReturn(Optional.of(aUser("pro@test.com")));
            when(familyRiskTrajectoryRepository.findById(FAMILY_TRAJECTORY_ID)).thenReturn(Optional.of(frt));
            lenient().when(memberRepository.findByEmail("pro@test.com")).thenReturn(Optional.empty());
            when(supportNetworkMemberRepository.findByEmail("pro@test.com")).thenReturn(Optional.of(pro));
            when(familySupportAssignmentRepository.findByFamilyIdAndSupportMemberId(FAMILY_ID, 7L))
                    .thenReturn(Optional.of(assignment));

            assertThat(evaluator.canCloseSafetyProtocol(FAMILY_TRAJECTORY_ID)).isFalse();
        }

        @Test
        @DisplayName("false para un miembro ordinario de la familia (no guardian, no profesional)")
        void falseForOrdinaryMember() {
            Family family = aFamily(GUARDIAN_MEMBER_ID);
            FamilyRiskTrajectory frt = aFamilyTrajectory(family);
            FamilyMember ordinaryMember = FamilyMember.builder().id(9L).family(family).email("member@test.com").build();

            authenticateAs("member@test.com");
            when(userRepository.findByEmailIgnoreCase("member@test.com"))
                    .thenReturn(Optional.of(aUser("member@test.com")));
            when(familyRiskTrajectoryRepository.findById(FAMILY_TRAJECTORY_ID)).thenReturn(Optional.of(frt));
            when(memberRepository.findByEmail("member@test.com")).thenReturn(Optional.of(ordinaryMember));
            when(supportNetworkMemberRepository.findByEmail("member@test.com")).thenReturn(Optional.empty());

            assertThat(evaluator.canCloseSafetyProtocol(FAMILY_TRAJECTORY_ID)).isFalse();
        }

        @Test
        @DisplayName("false si la trayectoria familiar no existe")
        void falseIfTrajectoryNotFound() {
            authenticateAs("someone@test.com");
            when(userRepository.findByEmailIgnoreCase("someone@test.com"))
                    .thenReturn(Optional.of(aUser("someone@test.com")));
            when(familyRiskTrajectoryRepository.findById(FAMILY_TRAJECTORY_ID)).thenReturn(Optional.empty());

            assertThat(evaluator.canCloseSafetyProtocol(FAMILY_TRAJECTORY_ID)).isFalse();
        }
    }
}
