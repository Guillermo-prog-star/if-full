package com.integrityfamily.interop.fhir.mapper;

import com.integrityfamily.interop.canonical.Observation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("ObservationFhirMapper")
class ObservationFhirMapperTest {

    @Test
    @DisplayName("subjectId con prefijo family- → referencia a Group")
    void shouldReferenceGroup_forFamilySubject() {
        Observation obs = Observation.builder()
                .canonicalId("evaluation-100-icf")
                .subjectId("family-1")
                .code("ICF").display("Índice de Cohesión Familiar")
                .valueNumeric(72.5)
                .effectiveAt(LocalDateTime.of(2026, 7, 1, 10, 0))
                .status("FINAL")
                .build();

        var fhirObs = ObservationFhirMapper.toFhir(obs);

        assertThat(fhirObs.getId()).isEqualTo("evaluation-100-icf");
        assertThat(fhirObs.getSubject().getReference()).isEqualTo("Group/family-1");
        assertThat(fhirObs.getStatus()).isEqualTo(org.hl7.fhir.r4.model.Observation.ObservationStatus.FINAL);
        assertThat(fhirObs.getValueQuantity().getValue().doubleValue()).isEqualTo(72.5);
        assertThat(fhirObs.getCode().getText()).isEqualTo("Índice de Cohesión Familiar");
    }

    @Test
    @DisplayName("subjectId con prefijo member- → referencia a Patient")
    void shouldReferencePatient_forMemberSubject() {
        Observation obs = Observation.builder()
                .canonicalId("obs-1").subjectId("member-5")
                .code("X").display("X").status("PRELIMINARY").build();

        var fhirObs = ObservationFhirMapper.toFhir(obs);

        assertThat(fhirObs.getSubject().getReference()).isEqualTo("Patient/member-5");
        assertThat(fhirObs.getStatus()).isEqualTo(org.hl7.fhir.r4.model.Observation.ObservationStatus.PRELIMINARY);
    }

    @Test
    @DisplayName("valueText en vez de valueNumeric → se mapea como StringType")
    void shouldMapTextValue() {
        Observation obs = Observation.builder()
                .canonicalId("obs-2").subjectId("family-1")
                .code("NOTE").display("Nota").valueText("texto libre")
                .status("FINAL").build();

        var fhirObs = ObservationFhirMapper.toFhir(obs);

        assertThat(fhirObs.getValueStringType().getValue()).isEqualTo("texto libre");
    }

    @Test
    @DisplayName("status desconocido/null → UNKNOWN, no lanza excepción")
    void shouldDefaultToUnknownStatus() {
        Observation obs = Observation.builder()
                .canonicalId("obs-3").subjectId("family-1")
                .code("X").display("X").status(null).build();

        var fhirObs = ObservationFhirMapper.toFhir(obs);

        assertThat(fhirObs.getStatus()).isEqualTo(org.hl7.fhir.r4.model.Observation.ObservationStatus.UNKNOWN);
    }
}
