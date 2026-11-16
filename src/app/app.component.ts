import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { LinkService, SnipLink } from './link.service';

function httpUrlValidator(control: AbstractControl): ValidationErrors | null {
  try {
    const url = new URL(control.value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : { httpUrl: true };
  } catch {
    return { httpUrl: true };
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly linkService = inject(LinkService);

  readonly links = signal<SnipLink[]>([]);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly listError = signal('');
  readonly submissionError = signal('');
  readonly createdShortUrl = signal('');

  readonly linkForm = this.formBuilder.nonNullable.group({
    url: ['', [Validators.required, Validators.maxLength(2048), Validators.pattern(/^https?:\/\/\S+$/i), httpUrlValidator]]
  });

  get urlControl() {
    return this.linkForm.controls.url;
  }

  ngOnInit(): void {
    this.refreshLinks();
  }

  submit(): void {
    if (this.submitting() || this.linkForm.invalid) {
      this.linkForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.submissionError.set('');
    this.createdShortUrl.set('');
    if (this.urlControl.hasError('server')) {
      const errors = { ...this.urlControl.errors };
      delete errors['server'];
      this.urlControl.setErrors(Object.keys(errors).length ? errors : null);
    }

    this.linkService.createLink(this.urlControl.value.trim()).subscribe({
      next: (link) => {
        this.createdShortUrl.set(link.shortUrl);
        this.linkForm.reset();
        this.submitting.set(false);
        this.refreshLinks();
      },
      error: (error: unknown) => {
        const message = this.getErrorMessage(error);
        if (error instanceof HttpErrorResponse && error.status === 400) {
          this.urlControl.setErrors({ ...(this.urlControl.errors ?? {}), server: message });
          this.urlControl.markAsTouched();
        } else {
          this.submissionError.set(message);
        }
        this.submitting.set(false);
      }
    });
  }

  refreshLinks(): void {
    this.loading.set(true);
    this.listError.set('');

    this.linkService.getLinks().subscribe({
      next: (links) => {
        this.links.set(links);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.listError.set(this.getErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body: unknown = error.error;
      if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        return body.error;
      }
      if (error.status === 0) {
        return 'Could not reach the Snip API. Make sure the backend is running at http://localhost:3000.';
      }
      return error.message || 'The request could not be completed. Please try again.';
    }
    return 'Something went wrong. Please try again.';
  }
}
