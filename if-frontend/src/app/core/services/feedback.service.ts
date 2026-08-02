import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class FeedbackService {
  private http = inject(HttpClient);
  private api = inject(ApiService);

  sendFeedback(data: any): Observable<any> {
    return this.http.post(`${this.api.base}/feedback/send`, data);
  }

  getAllFeedback(): Observable<any> {
    return this.http.get(`${this.api.base}/feedback/all`);
  }
}
