import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HudContextService } from '../core/hud-context.service';
import { FamilyStateService } from '../../../core/services/family-state.service';

@Component({
  selector: 'app-adaptive-hud-shell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './adaptive-hud-shell.component.html',
  styleUrl: './adaptive-hud-shell.component.css'
})
export class AdaptiveHudShellComponent implements OnInit {
  readonly hudService = inject(HudContextService);
  private readonly familyState = inject(FamilyStateService);
  private readonly router = inject(Router);

  familyName = '';
  viewData: any = null;

  ngOnInit(): void {
    this.familyName = this.familyState.currentFamilyName() || 'Familia';
    
    this.hudService.hudView$.subscribe(view => {
      this.viewData = view;
    });

    this.hudService.loadHud();
  }

  toggleHudType(): void {
    const current = this.hudService.getHudType();
    const target = current === 'FAMILY' ? 'PROFESSIONAL' : 'FAMILY';
    this.hudService.setHudType(target);
  }

  onNavigate(route: string): void {
    // Navigate inside the application context
    console.log('Navigating to HUD section: ', route);
  }
}
