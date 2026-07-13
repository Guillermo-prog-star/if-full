package com.integrityfamily.interop.controller;

import com.integrityfamily.common.dto.ApiResponse;
import com.integrityfamily.interop.canonical.CanonicalFamilyRecord;
import com.integrityfamily.interop.service.CanonicalFamilyRecordAssembler;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Expone el registro canónico ensamblado (Fase 3) — endpoint de solo lectura
 * para verificación manual e inspección. Consumido eventualmente por el
 * FHIR Adapter de la Fase 4; no reemplaza ningún endpoint existente.
 */
@RestController
@RequestMapping("/api/families/{familyId}/interop")
@RequiredArgsConstructor
public class InteropController {

    private final CanonicalFamilyRecordAssembler assembler;

    @PreAuthorize("@familySecurity.check(#familyId)")
    @GetMapping("/canonical-record")
    public ApiResponse<CanonicalFamilyRecord> getCanonicalRecord(@PathVariable Long familyId) {
        return ApiResponse.ok(assembler.assemble(familyId));
    }
}
