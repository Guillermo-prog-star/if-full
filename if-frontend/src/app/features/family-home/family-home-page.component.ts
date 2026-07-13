import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { FamilyStateService } from '../../core/services/family-state.service';
import {
  Command,
  FamilyHomeStoreService,
  isActiveHomeView,
  isAssessmentHomeView,
  isOnboardingHomeView,
  isReturnStageHomeView,
} from '../../core/family-home';
import { FAMILY_HOME_SHARED_STYLES } from './family-home-shared.styles';
import { OnboardingHomeViewComponent } from './views/onboarding-home-view.component';
import { AssessmentHomeViewComponent } from './views/assessment-home-view.component';
import { ReturnStageHomeViewComponent } from './views/return-stage-home-view.component';
import { ActiveHomeViewComponent } from './views/active-home-view.component';

/**
 * Contenedor del Hogar Digital Familiar (IFRM-D, Hito 7). Ruta nueva —
 * no reemplaza /dashboard. Cubre las 4 vistas que el backend puede producir
 * hoy (Onboarding, Assessment, ReturnStage, ActiveHome); PausedHomeView queda
 * fuera de alcance porque no existe todavía un mecanismo de pausa persistido
 * (ver notas de Hito 5 sobre confirm-resume/resume-journey).
 */
@Component({
  selector: 'app-family-home-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    OnboardingHomeViewComponent,
    AssessmentHomeViewComponent,
    ReturnStageHomeViewComponent,
    ActiveHomeViewComponent,
  ],
  styles: [FAMILY_HOME_SHARED_STYLES, `
    .fh-header { margin-bottom: 32px; }
    .fh-header h1 { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -0.02em; margin: 0 0 6px; }
    .fh-header p { color: rgba(255,255,255,0.4); font-size: 14px; margin: 0; }
    .fh-empty { text-align: center; padding: 48px 24px; color: rgba(255,255,255,0.4); }
    .fh-retry { margin-top: 12px; }
    a.fh-link { color: #a5b4fc; text-decoration: none; font-weight: 700; }
    a.fh-link:hover { text-decoration: underline; }
  `],
  template: `
    <div class="fh-header">
      <h1>Hogar Digital Familiar</h1>
      <p>{{ familyState.currentFamilyName() || 'Tu espacio de acompañamiento diario' }}</p>
    </div>

    @if (resolvingFamily() || store.loading()) {
      <div class="glass-card">
        <div class="skeleton skeleton-line lg"></div>
        <div class="skeleton skeleton-line" style="width: 80%"></div>
        <div class="skeleton skeleton-line" style="width: 40%"></div>
      </div>
    } @else if (!hasHomeId()) {
      <div class="glass-card fh-empty">
        <p>No pudimos identificar el Hogar Digital de tu familia todavía.</p>
        <a class="fh-link" routerLink="/families">Ir a Mis Familias</a>
      </div>
    } @else {
      @if (store.error(); as err) {
        <div class="glass-card fh-empty">
          <p>{{ err.detail }}</p>
          <button class="fh-cta fh-retry" (click)="reload()">Reintentar</button>
        </div>
      }
      @if (!store.error() && store.view(); as v) {
        @if (v.safetyPresentation.mode !== 'NONE') {
          <div class="fh-safety-banner" [class]="v.safetyPresentation.mode.toLowerCase()">
            <span class="fh-safety-icon">⚠️</span>
            <div class="fh-safety-text">
              <strong>{{ v.safetyPresentation.title }}</strong>
              <span>{{ v.safetyPresentation.message }}</span>
            </div>
          </div>
        }

        @if (unsupportedAction(); as msg) {
          <div class="fh-toast">{{ msg }}</div>
        }

        @if (isOnboardingHomeView(v)) {
          <app-onboarding-home-view [view]="v" (command)="onCommand($event)" />
        } @else if (isAssessmentHomeView(v)) {
          <app-assessment-home-view [view]="v" (command)="onCommand($event)" />
        } @else if (isReturnStageHomeView(v)) {
          <app-return-stage-home-view [view]="v" [actionPending]="store.actionPending()" (command)="onCommand($event)" />
        } @else if (isActiveHomeView(v)) {
          <app-active-home-view [view]="v" (command)="onCommand($event)" />
        } @else {
          <div class="glass-card fh-empty">
            <p>Esta vista del Hogar Digital todavía no está disponible en este panel.</p>
          </div>
        }
      }
    }
  `,
})
export class FamilyHomePageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly familyState = inject(FamilyStateService);
  readonly store = inject(FamilyHomeStoreService);

  readonly resolvingFamily = signal(false);
  readonly unsupportedAction = signal<string | null>(null);

  readonly hasHomeId = computed(() => !!this.familyState.currentHomeId());

  readonly isOnboardingHomeView = isOnboardingHomeView;
  readonly isAssessmentHomeView = isAssessmentHomeView;
  readonly isReturnStageHomeView = isReturnStageHomeView;
  readonly isActiveHomeView = isActiveHomeView;

  ngOnInit(): void {
    this.ensureHomeId();
  }

  reload(): void {
    const homeId = this.familyState.getSelectedHomeId();
    if (homeId) {
      this.store.load(homeId);
    }
  }

  onCommand(command: Command): void {
    if (!command.enabled) return;
    this.unsupportedAction.set(null);

    if (command.type === 'NAVIGATE') {
      this.router.navigateByUrl(command.target);
      return;
    }

    if (command.type === 'SUBMIT_ACTION' && command.target === 'accept-first-sprint') {
      const homeId = this.familyState.getSelectedHomeId();
      if (homeId) this.store.acceptFirstSprint(homeId);
      return;
    }

    this.unsupportedAction.set(`"${command.label}" todavía no está disponible en el Hogar Digital.`);
  }

  /**
   * homeId se persiste al elegir/crear familia (ver FamilyStateService.setFamily),
   * pero si el usuario aterriza aquí sin haber pasado por ese flujo, se resuelve
   * una vez contra /families/mine — mismo protocolo de auto-conexión usado en
   * DashboardPageComponent y EvaluationComponent.
   */
  private ensureHomeId(): void {
    const homeId = this.familyState.getSelectedHomeId();
    if (homeId) {
      this.store.load(homeId);
      return;
    }

    this.resolvingFamily.set(true);
    this.http.get<any>(`${this.api.base}/families/mine`)
      .pipe(catchError(() => of(null)))
      .subscribe((res) => {
        this.resolvingFamily.set(false);
        const family = res?.data ?? res;
        if (family?.id) {
          this.familyState.setFamily(family);
          const resolvedHomeId = this.familyState.getSelectedHomeId();
          if (resolvedHomeId) this.store.load(resolvedHomeId);
        }
      });
  }
}
