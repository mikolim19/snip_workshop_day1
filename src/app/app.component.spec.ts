import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { SnipLink } from './link.service';

describe('AppComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('rejects non-http(s) URLs without sending a request', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('http://localhost:3000/api/links').flush([]);

    fixture.componentInstance.linkForm.controls.url.setValue('ftp://example.com/file');
    fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(fixture.componentInstance.linkForm.controls.url.invalid).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Enter a valid http:// or https:// URL');
    http.expectNone('http://localhost:3000/api/links');
  });

  it('creates a link and refreshes the links table', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('http://localhost:3000/api/links').flush([]);

    const link: SnipLink = {
      code: 'a1B2c3',
      url: 'https://example.com/article',
      shortUrl: 'http://localhost:3000/a1B2c3',
      hits: 0,
      createdAt: '2026-01-01T00:00:00.000Z'
    };
    fixture.componentInstance.linkForm.controls.url.setValue(link.url);
    fixture.componentInstance.submit();

    const createRequest = http.expectOne('http://localhost:3000/api/links');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual({ url: link.url });
    createRequest.flush(link);
    http.expectOne('http://localhost:3000/api/links').flush([link]);
    fixture.detectChanges();

    expect(fixture.componentInstance.createdShortUrl()).toBe(link.shortUrl);
    expect(fixture.componentInstance.links()).toEqual([link]);
    expect(fixture.nativeElement.textContent).toContain(link.url);
    expect(fixture.nativeElement.textContent).toContain('0');
  });

  it('shows a server validation error beside the URL field', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('http://localhost:3000/api/links').flush([]);
    fixture.componentInstance.linkForm.controls.url.setValue('https://example.com');
    fixture.componentInstance.submit();

    http.expectOne('http://localhost:3000/api/links').flush(
      { error: 'URL was rejected' },
      { status: 400, statusText: 'Bad Request' }
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('URL was rejected');
    expect(fixture.componentInstance.linkForm.controls.url.hasError('server')).toBeTrue();
  });
});
