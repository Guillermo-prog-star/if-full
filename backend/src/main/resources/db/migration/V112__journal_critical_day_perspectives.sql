-- V112: Perspectivas multiples sobre un mismo evento familiar (H2, ADR-012).
--
-- journal_entries no tenia columna de autor (solo family_id) -- bloqueaba
-- incluso H1 (de quien es cada relato). critical_days ya tenia member_id
-- pero ninguna clave para vincular dos relatos del mismo incidente real.
-- Ver ADR-012 para la verificacion completa contra el codigo.
--
-- perceived_event_key es una cadena opaca asignada por el cliente (no
-- inferida por IA ni por coincidencia de fecha/categoria) -- se descarta a
-- proposito una entidad FamilyEvent nueva mientras no exista un segundo
-- consumidor real (mismo criterio que ADR-004 aplico al bounded context
-- research descartado).
--
-- visibility es PRIVATE por defecto: ninguna fila se expone a otro miembro
-- salvo que su propio autor la comparta explicitamente (nunca automatico).
ALTER TABLE journal_entries
    ADD COLUMN member_id BIGINT NULL AFTER family_id,
    ADD COLUMN perceived_event_key VARCHAR(64) NULL AFTER member_id,
    ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'PRIVATE' AFTER perceived_event_key,
    ADD CONSTRAINT fk_journal_entries_member FOREIGN KEY (member_id) REFERENCES family_members(id) ON DELETE SET NULL,
    ADD INDEX idx_journal_entries_perceived_event_key (perceived_event_key);

ALTER TABLE critical_days
    ADD COLUMN perceived_event_key VARCHAR(64) NULL AFTER member_id,
    ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'PRIVATE' AFTER perceived_event_key,
    ADD INDEX idx_critical_days_perceived_event_key (perceived_event_key);

-- Backfill: las filas ya existentes de critical_days que tienen member_id
-- (reportadas por un miembro real, ver CrisisServiceImpl.registerCrisis)
-- se dejan en PRIVATE por defecto -- es el valor mas conservador y no
-- cambia comportamiento observable hasta este ADR (antes no habia
-- filtrado alguno). Las que no tienen member_id (ej. SENTINEL_ALERT
-- generadas por AiInferenceService) tambien quedan PRIVATE pero el filtro
-- de lectura (JournalEntryRepository/CriticalDayRepository.findVisibleToMember)
-- las trata como visibles a todos por no tener autor -- no requieren backfill.
