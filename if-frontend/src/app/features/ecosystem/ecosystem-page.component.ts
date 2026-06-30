import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FamilyStateService } from '../../core/services/family-state.service';
import {
  EcosystemService, EcosystemSummary, EcosystemLink,
  EcosystemParticipant, NetworkType, EcosystemAccessScope, AuditEntry
} from '../../core/services/ecosystem.service';
import { catchError, of } from 'rxjs';

type ActiveTab = 'network' | 'catalog' | 'audit';

interface InviteForm {
  participantId: number | null;
  objective: string;
  responsibilities: string;
  validFrom: string;
  validUntil: string;
  scope: EcosystemAccessScope;
}

interface ConsentForm {
  linkId: number;
  scope: EcosystemAccessScope;
}

const DEFAULT_SCOPE: EcosystemAccessScope = {
  canViewIcfScore: false,
  canViewRiskLevel: false,
  canViewPlanSummary: false,
  canViewSprintProgress: false,
  canViewCrisisHistory: false,
  canReceiveAlerts: false
};

@Component({
  selector: 'app-ecosystem-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ecosystem-page.component.html',
  styleUrls: ['./ecosystem-page.component.css']
})
export class EcosystemPageComponent implements OnInit {
  private familyState = inject(FamilyStateService);
  private svc         = inject(EcosystemService);

  readonly activeTab    = signal<ActiveTab>('network');
  readonly summary      = signal<EcosystemSummary | null>(null);
  readonly catalog      = signal<EcosystemParticipant[]>([]);
  readonly auditLog     = signal<AuditEntry[]>([]);
  readonly loading      = signal(true);
  readonly loadingCat   = signal(false);
  readonly loadingAudit = signal(false);
  readonly error        = signal<string | null>(null);
  readonly actionMsg    = signal<string | null>(null);
  readonly actionErr    = signal<string | null>(null);

  readonly catalogFilter  = signal<NetworkType | 'ALL'>('ALL');
  readonly catalogSearch  = signal('');
  readonly showInviteModal   = signal(false);
  readonly showConsentModal  = signal(false);
  readonly showRevokeModal   = signal(false);
  readonly revokeReason      = signal('');
  readonly pendingRevokeId   = signal<number | null>(null);
  readonly pendingConsentLink = signal<EcosystemLink | null>(null);
  readonly pendingInviteParticipant = signal<EcosystemParticipant | null>(null);
  readonly actionLoading     = signal(false);

  readonly inviteForm = signal<InviteForm>({
    participantId: null,
    objective: '',
    responsibilities: '',
    validFrom: '',
    validUntil: '',
    scope: { ...DEFAULT_SCOPE }
  });

  readonly consentForm = signal<ConsentForm>({
    linkId: 0,
    scope: { ...DEFAULT_SCOPE }
  });

  readonly filteredCatalog = computed(() => {
    const type   = this.catalogFilter();
    const search = this.catalogSearch().toLowerCase().trim();
    return this.catalog()
      .filter(p => type === 'ALL' || p.networkType === type)
      .filter(p => !search
        || p.name.toLowerCase().includes(search)
        || (p.description ?? '').toLowerCase().includes(search));
  });

  readonly totalActive  = computed(() => this.summary()?.activeLinks ?? 0);
  readonly totalLinks   = computed(() => this.summary()?.totalLinks ?? 0);
  readonly totalPending = computed(() => this.pendingLinks().length);

  readonly networkSections = computed(() => [
    { key: 'familiar',      label: 'Red Familiar',   icon: '👨‍👩‍👧', links: this.summary()?.familiar      ?? [] },
    { key: 'institutional', label: 'Institucional',  icon: '🏛️',   links: this.summary()?.institutional ?? [] },
    { key: 'community',     label: 'Comunitaria',    icon: '🤝',   links: this.summary()?.community     ?? [] },
    { key: 'territorial',   label: 'Territorial',    icon: '🌍',   links: this.summary()?.territorial   ?? [] },
  ].filter(s => s.links.some(l => l.status !== 'INVITED')));

  private get familyId(): number {
    return this.familyState.getSelectedFamilyId();
  }

  ngOnInit() { this.loadSummary(); }

  setTab(tab: ActiveTab) {
    this.activeTab.set(tab);
    if (tab === 'catalog' && this.catalog().length === 0) this.loadCatalog();
    if (tab === 'audit'   && this.auditLog().length === 0) this.loadAudit();
  }

  private loadSummary() {
    this.loading.set(true);
    this.error.set(null);
    this.svc.getSummary(this.familyId).pipe(
      catchError(() => { this.error.set('No se pudo cargar el ecosistema.'); return of(null); })
    ).subscribe(s => { this.summary.set(s); this.loading.set(false); });
  }

  private loadCatalog() {
    this.loadingCat.set(true);
    this.svc.getParticipants().pipe(catchError(() => of([])))
      .subscribe(list => { this.catalog.set(list); this.loadingCat.set(false); });
  }

  private loadAudit() {
    this.loadingAudit.set(true);
    this.svc.getAuditLog(this.familyId).pipe(catchError(() => of([])))
      .subscribe(log => { this.auditLog.set(log); this.loadingAudit.set(false); });
  }

  openInviteModal(participant: EcosystemParticipant) {
    this.pendingInviteParticipant.set(participant);
    this.inviteForm.set({
      participantId: participant.id,
      objective: '',
      responsibilities: '',
      validFrom: '',
      validUntil: '',
      scope: { ...DEFAULT_SCOPE }
    });
    this.showInviteModal.set(true);
    this.clearMessages();
  }

  closeInviteModal() { this.showInviteModal.set(false); this.pendingInviteParticipant.set(null); }

  submitInvite() {
    const f = this.inviteForm();
    if (!f.participantId) return;
    this.actionLoading.set(true);
    this.clearMessages();
    this.svc.link(this.familyId, {
      participantId: f.participantId,
      objective: f.objective || undefined,
      responsibilities: f.responsibilities || undefined,
      validFrom: f.validFrom || undefined,
      validUntil: f.validUntil || undefined,
      accessScope: f.scope
    }).pipe(
      catchError(err => { this.actionErr.set(err?.error?.message ?? 'Error al crear la conexión.'); return of(null); })
    ).subscribe(link => {
      this.actionLoading.set(false);
      if (link) {
        this.showInviteModal.set(false);
        this.actionMsg.set('Invitación enviada. Ahora puedes dar consentimiento en la pestaña Mi Red.');
        this.loadSummary();
      }
    });
  }

  openConsentModal(link: EcosystemLink) {
    this.pendingConsentLink.set(link);
    this.consentForm.set({ linkId: link.id, scope: link.accessScope ? { ...link.accessScope } : { ...DEFAULT_SCOPE } });
    this.showConsentModal.set(true);
    this.clearMessages();
  }

  closeConsentModal() { this.showConsentModal.set(false); this.pendingConsentLink.set(null); }

  submitConsent() {
    const f = this.consentForm();
    this.actionLoading.set(true);
    this.clearMessages();
    this.svc.giveConsent(this.familyId, f.linkId, f.scope).pipe(
      catchError(err => { this.actionErr.set(err?.error?.message ?? 'Error al dar consentimiento.'); return of(null); })
    ).subscribe(link => {
      this.actionLoading.set(false);
      if (link) {
        this.showConsentModal.set(false);
        this.actionMsg.set('Consentimiento otorgado. El participante ahora tiene acceso activo.');
        this.loadSummary();
      }
    });
  }

  openRevokeModal(linkId: number) {
    this.pendingRevokeId.set(linkId);
    this.revokeReason.set('');
    this.showRevokeModal.set(true);
    this.clearMessages();
  }

  closeRevokeModal() { this.showRevokeModal.set(false); this.pendingRevokeId.set(null); }

  submitRevoke() {
    const id = this.pendingRevokeId();
    if (!id) return;
    this.actionLoading.set(true);
    this.clearMessages();
    this.svc.revoke(this.familyId, id, this.revokeReason() || undefined).pipe(
      catchError(err => { this.actionErr.set(err?.error?.message ?? 'Error al revocar el acceso.'); return of(null); })
    ).subscribe(link => {
      this.actionLoading.set(false);
      if (link) {
        this.showRevokeModal.set(false);
        this.actionMsg.set('Acceso revocado. El participante ya no puede ver datos de tu familia.');
        this.loadSummary();
      }
    });
  }

  toggleInviteScope(key: keyof EcosystemAccessScope) {
    this.inviteForm.update(f => ({ ...f, scope: { ...f.scope, [key]: !f.scope[key] } }));
  }

  toggleConsentScope(key: keyof EcosystemAccessScope) {
    this.consentForm.update(f => ({ ...f, scope: { ...f.scope, [key]: !f.scope[key] } }));
  }

  setCatalogFilter(f: NetworkType | 'ALL') { this.catalogFilter.set(f); }
  setCatalogSearch(v: string)              { this.catalogSearch.set(v); }
  private clearMessages() { this.actionMsg.set(null); this.actionErr.set(null); }

  setInviteObjective(v: string)        { this.inviteForm.update(f => ({ ...f, objective: v })); }
  setInviteResponsibilities(v: string) { this.inviteForm.update(f => ({ ...f, responsibilities: v })); }
  setInviteValidFrom(v: string)        { this.inviteForm.update(f => ({ ...f, validFrom: v })); }
  setInviteValidUntil(v: string)       { this.inviteForm.update(f => ({ ...f, validUntil: v })); }
  setRevokeReason(v: string)           { this.revokeReason.set(v); }

  networkLabel(t: NetworkType | string): string {
    const m: Record<string, string> = {
      FAMILIAR: 'Familiar', PROFESSIONAL: 'Profesional',
      INSTITUTIONAL: 'Institucional', COMMUNITY: 'Comunitaria', TERRITORIAL: 'Territorial'
    };
    return m[t] ?? t;
  }

  networkIcon(t: NetworkType | string): string {
    const m: Record<string, string> = {
      FAMILIAR: '👨‍👩‍👧', PROFESSIONAL: '🩺',
      INSTITUTIONAL: '🏛️', COMMUNITY: '🤝', TERRITORIAL: '🌍'
    };
    return m[t] ?? '🔗';
  }

  statusLabel(s: string): string {
    const m: Record<string, string> = {
      INVITED: 'Pendiente', ACTIVE: 'Activo', SUSPENDED: 'Suspendido', REVOKED: 'Revocado'
    };
    return m[s] ?? s;
  }

  statusIcon(s: string): string {
    const m: Record<string, string> = {
      INVITED: '⏳', ACTIVE: '✅', SUSPENDED: '⏸️', REVOKED: '🚫'
    };
    return m[s] ?? '•';
  }

  formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  scopeKeys(): (keyof EcosystemAccessScope)[] {
    return ['canViewIcfScore', 'canViewRiskLevel', 'canViewPlanSummary',
            'canViewSprintProgress', 'canViewCrisisHistory', 'canReceiveAlerts'];
  }

  scopeLabel(k: keyof EcosystemAccessScope): string {
    const m: Record<string, string> = {
      canViewIcfScore:       'ICF Score',
      canViewRiskLevel:      'Nivel de riesgo',
      canViewPlanSummary:    'Resumen del plan',
      canViewSprintProgress: 'Progreso sprint',
      canViewCrisisHistory:  'Historial de crisis',
      canReceiveAlerts:      'Recibir alertas'
    };
    return m[k] ?? k;
  }

  scopeIcon(k: keyof EcosystemAccessScope): string {
    const m: Record<string, string> = {
      canViewIcfScore:       '🔢',
      canViewRiskLevel:      '⚠️',
      canViewPlanSummary:    '📋',
      canViewSprintProgress: '🏃',
      canViewCrisisHistory:  '🔴',
      canReceiveAlerts:      '🔔'
    };
    return m[k] ?? '•';
  }

  allLinksInOrder(): EcosystemLink[] {
    const s = this.summary();
    if (!s) return [];
    return [...(s.familiar ?? []), ...(s.institutional ?? []), ...(s.community ?? []), ...(s.territorial ?? [])];
  }

  pendingLinks(): EcosystemLink[] {
    return this.allLinksInOrder().filter(l => l.status === 'INVITED');
  }

  activeLinks(): EcosystemLink[] {
    return this.allLinksInOrder().filter(l => l.status === 'ACTIVE');
  }

  activeScopeCount(link: EcosystemLink): number {
    if (!link.accessScope) return 0;
    return Object.values(link.accessScope).filter(Boolean).length;
  }
}
