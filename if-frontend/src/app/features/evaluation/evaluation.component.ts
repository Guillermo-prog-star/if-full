import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AssessmentService } from '../../core/services/assessment.service';
import { Question, SaveAnswerRequest, FinalizeRequest } from '../../core/models/question.model';
import { NarrativeCompanionComponent } from '../../shared/components/narrative-companion.component';
import { FamilyStateService } from '../../core/services/family-state.service';
import { getFallbackQuestions } from '../../core/data/fallback-questions';
import { catchError, EMPTY } from 'rxjs';
import { PRESENCE_SCALE } from '../../../domain/constants/presenceScaleDomain';
import { environment } from '../../../environments/environment';

export interface Scenario {
  parentKey: string;
  dimension: string;
  textBase: string;
  type?: string;
  area?: string;
  severityWeight?: number;
  entry?: Question;
  timing?: Question;
  action?: Question;
}


@Component({
  selector: 'app-evaluation',
  standalone: true,
  imports: [CommonModule, RouterLink, NarrativeCompanionComponent],
  templateUrl: './evaluation.component.html',
  styleUrls: ['./evaluation.component.css']
})
export class EvaluationComponent implements OnInit {
  private assessmentService = inject(AssessmentService);
  private familyState       = inject(FamilyStateService);
  readonly router = inject(Router);
  private route  = inject(ActivatedRoute);
  private http   = inject(HttpClient);

  evaluationId: number = 0;
  questions: Question[] = [];
  scenarios: Scenario[] = [];
  currentIndex: number = 0;
  /** Mapa questionId → valor (1-5). Se usa como estado local y como fallback clásico. */
  answers: Map<number, number> = new Map();
  isFinished: boolean = false;
  isTransitioning: boolean = false;
  isLoadingResults: boolean = false;
  loadError: string = '';
  loadingMessage: string = 'Preparando tu diagnóstico personalizado...';
  private retryCount = 0;
  familyId: number = 0;
  familyName: string = '';

  /** Pilar activo recibido como query param desde EvaluationStartPage */
  activePillar: string = '';
  readonly PILLAR_META: Record<string, { icon: string; name: string; color: string; range: string }> = {
    reconocimiento: { icon: '💛', name: 'Reconocimiento', color: '#fbbf24', range: 'Meses 1–6' },
    amor:           { icon: '❤️', name: 'Amor',           color: '#ef4444', range: 'Meses 7–18' },
    entrega:        { icon: '💙', name: 'Entrega',         color: '#3b82f6', range: 'Meses 19–36' },
  };
  get pillarMeta() { return this.PILLAR_META[this.activePillar] ?? null; }

  /**
   * Indica si algún guardado incremental falló.
   * En ese caso, sendResults() vuelve al modo clásico (envía todas las respuestas en el body).
   */
  incrementalSaveFailed: boolean = false;
  finalizeError: string = '';

  ngOnInit(): void {
    this.familyId   = this.familyState.currentFamilyId();
    this.familyName = this.familyState.currentFamilyName() || 'la familia';

    this.route.params.subscribe((params: any) => {
      this.evaluationId = Number(params['id']);
      if (!this.evaluationId) {
        this.router.navigate(['/evaluations/start']);
      }
    });

    // Leer el pilar seleccionado desde query params
    this.activePillar = this.route.snapshot.queryParamMap.get('pillar') ?? '';

    // ── Carga local INMEDIATA — sin importar si familyId está disponible ──
    // El usuario ve las preguntas al instante; el backend se resuelve en paralelo.
    this.questions = getFallbackQuestions(this.activePillar);

    if (this.familyId === 0) {
      // Recuperar familia en segundo plano (no bloquea la pantalla)
      this.http.get<any>(`${environment.apiBaseUrl}/families/mine`).subscribe({
        next: res => {
          const family = res?.data ?? res;
          if (family?.id) {
            this.familyState.setFamily(family);
            this.familyId   = family.id;
            this.familyName = family.name || 'la familia';
            this.loadQuestions(); // actualiza con preguntas reales del backend
          }
          // Si no hay familia: dejamos las preguntas locales — no redirigimos
        },
        error: () => { /* silencioso — preguntas locales ya están activas */ }
      });
      return;
    }
    this.loadQuestions();
  }

  
  loadQuestions(): void {
    if (this.familyId === 0) return;
    const milestone = this.familyState.currentMilestone() || undefined;
    const pillar = this.activePillar || undefined;

    this.questions     = getFallbackQuestions(pillar);
    this.groupIntoScenarios();
    this.loadError     = '';
    this.loadingMessage = '';
    if (this.evaluationId > 0) this.restoreProgress();

    this.assessmentService.getRandomQuestions(this.familyId, milestone, pillar).subscribe({
      next: (data: Question[]) => {
        if (data && data.length > 0) {
          this.questions = data;
          this.groupIntoScenarios();
        }
      },
      error: () => {}
    });
  }

  private groupIntoScenarios(): void {
    const map = new Map<string, Scenario>();
    const oldStyle: Scenario[] = [];

    for (const q of this.questions) {
      if (q.parentKey) {
        let sc = map.get(q.parentKey);
        if (!sc) {
          // Extraemos el texto base quitando " (Momento...)"
          const textBase = q.text.replace(/\s*\(.*?\)\s*/g, '').trim();
          sc = { 
            parentKey: q.parentKey, 
            dimension: q.dimension, 
            textBase,
            type: q.type,
            area: q.area,
            severityWeight: q.severityWeight
          };
          map.set(q.parentKey, sc);
        }
        if (q.phase === 'ENTRY') sc.entry = q;
        else if (q.phase === 'TIMING') sc.timing = q;
        else if (q.phase === 'ACTION') sc.action = q;
      } else {
        oldStyle.push({
          parentKey: q.id.toString(),
          dimension: q.dimension,
          textBase: q.text,
          type: q.type,
          area: q.area,
          severityWeight: q.severityWeight,
          action: q // Usamos action como default para legacy
        });
      }
    }
    this.scenarios = Array.from(map.values()).concat(oldStyle);
  }

  private restoreProgress(): void {
    this.assessmentService.getProgress(this.evaluationId).pipe(
      catchError(() => EMPTY)
    ).subscribe(progress => {
      if (!progress || progress.answered === 0) return;

      // Reconstruir el Map de respuestas desde las que ya estaban guardadas
      progress.answers.forEach(saved => {
        if (saved.questionId != null) {
          this.answers.set(saved.questionId, saved.score);
        }
      });

      // Avanzar al índice de la primera pregunta sin responder
      const firstUnanswered = this.scenarios.findIndex(sc => (sc.entry && !this.answers.has(sc.entry.id)) || (sc.timing && !this.answers.has(sc.timing.id)) || (sc.action && !this.answers.has(sc.action.id)));

      // Reconstruir scenarioCompleted para escenarios ya resueltos
      for (let i = 0; i < this.scenarios.length; i++) {
        const s = this.scenarios[i];
        const entryOk = !s.entry || this.answers.has(s.entry.id);
        const timingOk = !s.timing || this.answers.has(s.timing.id);
        const actionOk = !s.action || this.answers.has(s.action.id);
        if (entryOk && timingOk && actionOk) {
          this.scenarioCompleted.add(s.parentKey);
        }
      }
      console.log(`[ASSESSMENT] Restaurados ${this.scenarioCompleted.size} escenarios completados.`);

      if (firstUnanswered > 0) {
        this.currentIndex = firstUnanswered;
        this.furthestIndex = firstUnanswered;
        console.log(`[ASSESSMENT] Reanudando desde pregunta ${firstUnanswered + 1} (${progress.answered} ya respondidas).`);
        this.scrollToTop();
      }
    });
  }

  private scrollToTop(): void {
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  
  /** Indica si se debe mostrar el hint de "puedes volver atrás" */
  showReturnHint: boolean = false;
  private returnHintTimer: any = null;

  /** Índice más alto alcanzado (distingue avance de revisión) */
  private furthestIndex: number = 0;

  /**
   * Registro explícito de escenarios completados.
   * Un escenario se marca como completed cuando sus 3 fases quedan respondidas.
   * Se usa como criterio de avance y como evidencia auditable.
   */
  scenarioCompleted: Set<string> = new Set();

  selectAnswer(score: number, questionId: number): void {
    if (this.isTransitioning) return;
    this.answers.set(questionId, score);

    if (this.evaluationId > 0) {
      const payload: SaveAnswerRequest[] = [{ questionId: questionId, value: score }];
      this.assessmentService.saveAnswers(this.evaluationId, payload).pipe(
        catchError(err => {
          this.incrementalSaveFailed = true;
          return EMPTY;
        })
      ).subscribe();
    }

    const sc = this.scenarios[this.currentIndex];
    if (!sc) return;

    // Verificar si la tríada completa acaba de quedar respondida
    const allPhasesAnswered = this.canAdvance();

    if (allPhasesAnswered) {
      const wasAlreadyCompleted = this.scenarioCompleted.has(sc.parentKey);

      // Marcar scenario_completed = true
      this.scenarioCompleted.add(sc.parentKey);
      console.log(`[ASSESSMENT] Escenario "${sc.parentKey}" → scenario_completed = true (${this.scenarioCompleted.size}/${this.scenarios.length})`);

      // Auto-avance SOLO si:
      // 1. El escenario NO estaba completado antes (transición incompleto → completo)
      // 2. NO estamos revisando un escenario previo
      const isReviewing = this.currentIndex < this.furthestIndex;
      if (!wasAlreadyCompleted && !isReviewing) {
        setTimeout(() => this.nextScenario(), 600);
      }
    }
  }

  nextScenario(): void {
    if (!this.canAdvance()) return;
    this.isTransitioning = true;
    setTimeout(() => {
      if (this.currentIndex < this.scenarios.length - 1) {
        this.currentIndex++;
        if (this.currentIndex > this.furthestIndex) {
          this.furthestIndex = this.currentIndex;
        }
        this.isTransitioning = false;
        this.scrollToTop();
        this.flashReturnHint();
      } else {
        this.isTransitioning = false;
        this.sendResults();
      }
    }, 350);
  }

  canAdvance(): boolean {
    const sc = this.scenarios[this.currentIndex];
    if (!sc) return false;
    if (sc.entry && !this.answers.has(sc.entry.id)) return false;
    if (sc.timing && !this.answers.has(sc.timing.id)) return false;
    if (sc.action && !this.answers.has(sc.action.id)) return false;
    return true;
  }

  /** Verificar si un escenario específico está completado */
  isScenarioCompleted(idx: number): boolean {
    const sc = this.scenarios[idx];
    return sc ? this.scenarioCompleted.has(sc.parentKey) : false;
  }

  prevQuestion(): void {
    if (this.currentIndex > 0 && !this.isTransitioning) {
      this.isTransitioning = true;
      setTimeout(() => {
        this.currentIndex--;
        this.isTransitioning = false;
        this.scrollToTop();
      }, 200);
    }
  }

  /** Navegar directamente a un escenario previamente completado (clic en barra de progreso) */
  goToScenario(idx: number): void {
    if (idx >= this.currentIndex || this.isTransitioning) return; // solo hacia atrás
    this.isTransitioning = true;
    setTimeout(() => {
      this.currentIndex = idx;
      this.isTransitioning = false;
      this.scrollToTop();
    }, 200);
  }

  /** Muestra brevemente el hint de retorno y lo oculta tras 4 segundos */
  private flashReturnHint(): void {
    this.showReturnHint = true;
    if (this.returnHintTimer) clearTimeout(this.returnHintTimer);
    this.returnHintTimer = setTimeout(() => {
      this.showReturnHint = false;
    }, 4000);
  }

  sendResults(): void {
    this.isFinished = true;
    this.isLoadingResults = true;

    let payload: FinalizeRequest;

    if (!this.incrementalSaveFailed) {
      // ── Flujo mobile-first ──────────────────────────────────────────────
      // Las respuestas ya están en BD (guardadas incrementalmente).
      // El backend las carga y ejecuta RISK_ALGO_V1 sin necesitar el body.
      payload = {};
      console.log('[ASSESSMENT] Finalizando en modo mobile-first (respuestas ya en BD).');
    } else {
      // ── Flujo clásico (fallback) ────────────────────────────────────────
      // Algún guardado incremental falló (sin conexión temporal, etc.).
      // Se envían todas las respuestas acumuladas en el Map.
      payload = {
        answers: Array.from(this.answers.keys()).map(qId => ({
          questionId: Number(qId),
          value: Number(this.answers.get(qId))  // campo correcto: 'value', no 'answerValue'
        }))
      };
      console.log('[ASSESSMENT] Finalizando en modo clásico (fallback):', payload.answers?.length, 'respuestas.');
    }

    this.assessmentService.finalizeEvaluation(this.evaluationId, payload).subscribe({
      next: (response: any) => {
        console.log('[ASSESSMENT] Evaluación finalizada. Redirigiendo al resultado...');
        this.isLoadingResults = false;
        // Pasar el resultado en el estado de navegación para que el result-page lo muestre sin petición extra
        const result = response?.data ?? response;
        this.router.navigate(['/evaluations', this.evaluationId, 'result'], {
          state: { result, pillar: this.activePillar }
        });
      },
      error: (err: any) => {
        console.error('[ASSESSMENT] Error al finalizar:', err);
        this.isLoadingResults = false;
        this.isFinished = false; // Permitir reintentar
        this.finalizeError = err?.error?.message || err?.message || 'Error al finalizar el diagnóstico. Intenta de nuevo.';
      }
    });
  }

  restartTest(): void {
    this.currentIndex = 0;
    this.answers.clear();
    this.isFinished = false;
    this.isTransitioning = false;
    this.isLoadingResults = false;
    this.incrementalSaveFailed = false;
    this.loadQuestions();
    this.scrollToTop();
  }

  // ── Helpers de Taxonomía y Diseño Premium ──────────────────────────────────

  getDimensionColor(dimension: string): string {
    const normalized = (dimension || '').toLowerCase();
    switch (normalized) {
      case 'comunicacion': return 'var(--dim-communication)';
      case 'emociones':    return 'var(--dim-emotions)';
      case 'habitos':      return 'var(--dim-habits)';
      case 'tiempos':      return 'var(--dim-times)';
      default:             return 'var(--accent)';
    }
  }

  getDimensionColorGlow(dimension: string): string {
    const normalized = (dimension || '').toLowerCase();
    switch (normalized) {
      case 'comunicacion': return 'rgba(56, 189, 248, 0.2)';
      case 'emociones':    return 'rgba(251, 113, 133, 0.2)';
      case 'habitos':      return 'rgba(251, 191, 36, 0.2)';
      case 'tiempos':      return 'rgba(167, 139, 250, 0.2)';
      default:             return 'rgba(168, 85, 247, 0.2)';
    }
  }

  getDimensionName(dimension: string): string {
    const normalized = (dimension || '').toLowerCase();
    switch (normalized) {
      case 'comunicacion': return 'Comunicación Asertiva';
      case 'emociones':    return 'Regulación & Clima Emocional';
      case 'habitos':      return 'Hábitos & Convivencia Colectiva';
      case 'tiempos':      return 'Tiempos de Conexión Activa';
      default:             return dimension || 'Consciencia Familiar';
    }
  }

  getQuestionTypeLabel(type: string | undefined): string {
    switch ((type || '').toUpperCase()) {
      case 'CORE':        return 'Medición Longitudinal Base';
      case 'ADAPTIVE':    return 'Profundización por Vulnerabilidad';
      case 'FASE_PILLAR': return 'Evaluación de Hito Temporal';
      case 'MIRROR':      return 'Control de Consistencia Interna';
      case 'EXPLORATORY': return 'Exploración de Entorno IA';
      default:            return 'Reactivo de Consciencia';
    }
  }

  getQuestionTypeDesc(type: string | undefined): string {
    switch ((type || '').toUpperCase()) {
      case 'CORE':        return 'Mide la evolución histórica constante de los pilares del hogar.';
      case 'ADAPTIVE':    return 'Adaptada para indagar a fondo la dimensión con mayor riesgo detectado.';
      case 'FASE_PILLAR': return 'Alineada al hito temporal de la ruta de transformación familiar.';
      case 'MIRROR':      return 'Validador psicométrico para asegurar la sinceridad y consistencia clínica.';
      case 'EXPLORATORY': return 'Análisis predictivo de patrones emergentes asistido por Inteligencia Artificial.';
      default:            return 'Reactivo de diagnóstico familiar.';
    }
  }

  getSeverityLevel(weight: number | undefined): string {
    const val = weight ?? 0.5;
    if (val >= 0.8) return 'Impacto Crítico';
    if (val >= 0.6) return 'Impacto Alto';
    return 'Impacto Estructural';
  }

  getSeverityStars(weight: number | undefined): number[] {
    const val = weight ?? 0.5;
    const count = val >= 0.8 ? 3 : val >= 0.6 ? 2 : 1;
    return Array(count).fill(0);
  }

  getScoreLabel(score: number): string {
    const labels: Record<number, string> = {
      1: 'Inconsciente',
      2: 'Reactivo',
      3: 'Consciente',
      4: 'Intencional',
      5: 'Pleno'
    };
    return labels[score] || '';
  }

  getScoreDetail(score: number): string {
    const details: Record<number, string> = {
      1: 'No nos damos cuenta o lo vemos normal en el día a día.',
      2: 'Reaccionamos por impulso cuando ocurre, sin control previo.',
      3: 'Nos damos cuenta del patrón pero nos cuesta mucho gestionarlo.',
      4: 'Elegimos activamente actuar por el bienestar del hogar.',
      5: 'Fluye de manera natural con paz profunda y amor voluntario.'
    };
    return details[score] || '';
  }

  /**
   * Devuelve la guía experiencial específica para cada fase de la tríada.
   * Orienta al usuario a responder desde su cuerpo, emociones y pensamientos.
   */
  getPhaseGuidance(phase: 'ENTRY' | 'TIMING' | 'ACTION'): { icon: string; title: string; text: string } {
    switch (phase) {
      case 'ENTRY':
        return {
          icon: '🫀',
          title: '¿Qué sucede primero en usted?',
          text: 'Observe su cuerpo: ¿siente tensión, calor, nudo en el estómago, aceleración del corazón? Responda desde esa primera señal física, no desde lo que piensa que debería sentir.'
        };
      case 'TIMING':
        return {
          icon: '🧠',
          title: '¿Qué pasa entre la señal y su reacción?',
          text: 'Note sus emociones y pensamientos: ¿hay miedo, frustración, urgencia? ¿Logra hacer una pausa o la reacción es automática? Responda desde lo que realmente ocurre, no desde lo ideal.'
        };
      case 'ACTION':
        return {
          icon: '🤲',
          title: '¿Cómo responde habitualmente?',
          text: 'Piense en lo que hace normalmente en esta situación — no en lo que le gustaría hacer. ¿Cómo actúa su cuerpo, sus palabras, su tono? Sea honesto con su patrón real.'
        };
    }
  }

  /**
   * SDD: Obtiene las opciones de respuesta adaptativas y en primera persona.
   * Si la pregunta es de tipo TRAJECTORY o de prueba neuro-conductual, usa el nuevo
   * modelo epistemológico: Señal Corporal -> Conciencia -> Acción.
   */
  getCustomOptions(question: Question): { score: number; label: string; text: string; colorClass: string; hexColor: string }[] {
    if (!question) return [];
    
    // NUEVO MODELO NEURO-CONDUCTUAL
    if (question.type === 'NEURO_AWARENESS') {
      if (question.options && question.options.length > 0) {
        // Map dynamic options from backend
        // We set label to empty to avoid exposing internal levels to the user,
        // and assign a standard grey/neutral color to avoid bias.
        return question.options.map(opt => ({
          score: opt.scoreValue,
          label: '',
          text: opt.text,
          colorClass: '',
          hexColor: '#64748b'
        })).sort((a, b) => a.score - b.score);
      }
    }
    
    // Fallback para pruebas temporales o sin opciones DB
    if (question.type === 'TRAJECTORY' || question.questionKey?.startsWith('TEST-NEURO')) {
      return [
        { score: 1, label: '', text: 'No noto nada especial en mi cuerpo o reacción.', colorClass: '', hexColor: '#64748b' },
        { score: 2, label: '', text: 'Solo me doy cuenta después de haber reaccionado.', colorClass: '', hexColor: '#f87171' },
        { score: 3, label: '', text: 'Noto tensión, emoción o impulso mientras ocurre.', colorClass: '', hexColor: '#f59e0b' },
        { score: 4, label: '', text: 'Al notar esa señal, hago una pausa antes de responder.', colorClass: '', hexColor: '#3b82f6' },
        { score: 5, label: '', text: 'Puedo mantener calma, claridad y cuidado en mi respuesta.', colorClass: '', hexColor: '#10b981' }
      ];
    }

    // MODELO TRADICIONAL
    const dim = (question.dimension || '').toLowerCase().trim();
    if (dim.includes('emocion')) {
      return [
        { score: 1, label: 'Inconsciente', text: 'No noto que hago esto', colorClass: 'Gris', hexColor: '#64748b' },
        { score: 2, label: 'Reactivo', text: 'Me pasa frecuentemente', colorClass: 'Rojo Suave', hexColor: '#f87171' },
        { score: 3, label: 'Consciente', text: 'Ya empiezo a reconocerlo', colorClass: 'Amarillo', hexColor: '#f59e0b' },
        { score: 4, label: 'Intencional', text: 'Intento detenerme antes', colorClass: 'Azul', hexColor: '#3b82f6' },
        { score: 5, label: 'Pleno', text: 'Manejo mis emociones con calma', colorClass: 'Verde', hexColor: '#10b981' }
      ];
    } else if (dim.includes('comunicac')) {
      return [
        { score: 1, label: 'Inconsciente', text: 'Casi nunca escucho realmente', colorClass: 'Gris', hexColor: '#64748b' },
        { score: 2, label: 'Reactivo', text: 'Me altero fácilmente', colorClass: 'Rojo Suave', hexColor: '#f87171' },
        { score: 3, label: 'Consciente', text: 'A veces logro escuchar', colorClass: 'Amarillo', hexColor: '#f59e0b' },
        { score: 4, label: 'Intencional', text: 'Estoy aprendiendo a dialogar', colorClass: 'Azul', hexColor: '#3b82f6' },
        { score: 5, label: 'Pleno', text: 'Escucho con apertura y respeto', colorClass: 'Verde', hexColor: '#10b981' }
      ];
    } else if (dim.includes('habit') || dim.includes('hábito')) {
      return [
        { score: 1, label: 'Inconsciente', text: 'No pienso mucho en eso', colorClass: 'Gris', hexColor: '#64748b' },
        { score: 2, label: 'Reactivo', text: 'Solo cumplo si me presionan', colorClass: 'Rojo Suave', hexColor: '#f87171' },
        { score: 3, label: 'Consciente', text: 'A veces lo logro', colorClass: 'Amarillo', hexColor: '#f59e0b' },
        { score: 4, label: 'Intencional', text: 'Estoy creando disciplina', colorClass: 'Azul', hexColor: '#3b82f6' },
        { score: 5, label: 'Pleno', text: 'Ya es parte de mí', colorClass: 'Verde', hexColor: '#10b981' }
      ];
    } else if (dim.includes('tiemp')) {
      return [
        { score: 1, label: PRESENCE_SCALE[1].state, text: PRESENCE_SCALE[1].description, colorClass: PRESENCE_SCALE[1].colorCode, hexColor: '#64748b' },
        { score: 2, label: PRESENCE_SCALE[2].state, text: PRESENCE_SCALE[2].description, colorClass: PRESENCE_SCALE[2].colorCode, hexColor: '#f87171' },
        { score: 3, label: PRESENCE_SCALE[3].state, text: PRESENCE_SCALE[3].description, colorClass: PRESENCE_SCALE[3].colorCode, hexColor: '#f59e0b' },
        { score: 4, label: PRESENCE_SCALE[4].state, text: PRESENCE_SCALE[4].description, colorClass: PRESENCE_SCALE[4].colorCode, hexColor: '#3b82f6' },
        { score: 5, label: PRESENCE_SCALE[5].state, text: PRESENCE_SCALE[5].description, colorClass: PRESENCE_SCALE[5].colorCode, hexColor: '#10b981' }
      ];
    }
    
    // Default fallback
    return [
      { score: 1, label: 'Inconsciente', text: 'Casi nunca me doy cuenta', colorClass: 'Gris', hexColor: '#64748b' },
      { score: 2, label: 'Reactivo', text: 'Reacciono antes de pensar', colorClass: 'Rojo Suave', hexColor: '#f87171' },
      { score: 3, label: 'Consciente', text: 'A veces logro manejarlo', colorClass: 'Amarillo', hexColor: '#f59e0b' },
      { score: 4, label: 'Intencional', text: 'Estoy aprendiendo a responder mejor', colorClass: 'Azul', hexColor: '#3b82f6' },
      { score: 5, label: 'Pleno', text: 'Ya lo hago naturalmente', colorClass: 'Verde', hexColor: '#10b981' }
    ];
  }
}
