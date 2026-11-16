import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SnipLink {
  code: string;
  url: string;
  shortUrl: string;
  hits: number;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class LinkService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/links';

  getLinks(): Observable<SnipLink[]> {
    return this.http.get<SnipLink[]>(this.apiUrl);
  }

  createLink(url: string): Observable<SnipLink> {
    return this.http.post<SnipLink>(this.apiUrl, { url });
  }
}
