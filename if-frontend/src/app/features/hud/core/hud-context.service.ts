import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiService } from '../../../core/services/api.service';
import { FamilyStateService } from '../../../core/services/family-state.service';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { switchMap, catchError, tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class HudContextService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly familyState = inject(FamilyStateService);

  private readonly activeHudType = new BehaviorSubject<'FAMILY' | 'PROFESSIONAL'>('FAMILY');
  readonly activeHudType$ = this.activeHudType.asObservable();

  private readonly hudView = new BehaviorSubject<any>(null);
  readonly hudView$ = this.hudView.asObservable();

  constructor() {
    // Automatically trigger safe switchMap reload whenever context type changes
    this.activeHudType$.pipe(
      tap(() => this.hudView.next(null)), // Immediate cache clear on switch
      switchMap(type => {
        const familyId = this.familyState.getSelectedFamilyId();
        if (!familyId) return of(null);
        
        const endpoint = type === 'PROFESSIONAL' ? 'professional' : 'family';
        return this.http.get<any>(`${this.api.base}/api/v1/families/${familyId}/hud/${endpoint}`).pipe(
          catchError(err => {
            console.error('Error fetching HUD:', err);
            return of(null);
          })
        );
      })
    ).subscribe(data => {
      this.hudView.next(data);
    });
  }

  setHudType(type: 'FAMILY' | 'PROFESSIONAL'): void {
    this.activeHudType.next(type);
  }

  getHudType(): 'FAMILY' | 'PROFESSIONAL' {
    return this.activeHudType.value;
  }

  loadHud(): void {
    // Re-trigger by pushing current value
    this.activeHudType.next(this.activeHudType.value);
  }
}
