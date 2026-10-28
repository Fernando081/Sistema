import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    RouterLink,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);

  isSaving = signal(false);
  readonly challenge=signal<string|null>(null);
  readonly codeForm=this.fb.nonNullable.group({code:['',[Validators.required,Validators.pattern(/^(?:\d{6}|[a-fA-F0-9]{8}(?:-?[a-fA-F0-9]{8}){3})$/)]]});

  form = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {}

  submit(): void {
    if (this.form.invalid || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    this.authService.login(this.form.getRawValue()).pipe(
      finalize(() => this.isSaving.set(false))
    ).subscribe({
      next: result => {
        this.form.controls.password.reset();
        if('mfaRequired' in result){this.challenge.set(result.challenge);return;}
        this.enter();
      },
      error: () => {},
    });
  }

  verify():void{
    const challenge=this.challenge();if(!challenge||this.isSaving()||this.codeForm.invalid)return;
    this.isSaving.set(true);
    this.authService.completeMfa(challenge,this.codeForm.getRawValue().code).pipe(finalize(()=>this.isSaving.set(false))).subscribe({
      next:()=>{this.codeForm.reset();this.challenge.set(null);this.enter();},error:()=>this.codeForm.reset(),
    });
  }
  restart():void{if(this.isSaving())return;this.challenge.set(null);this.codeForm.reset();this.authService.clearSession();}
  private enter():void{
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const safeReturn = returnUrl?.startsWith('/') && !returnUrl.startsWith('//') && !returnUrl.startsWith('/login');
        const home = this.authService.getSessionIdentity()?.role === 'admin' ? '/dashboard' : '/venta';
        this.router.navigateByUrl(safeReturn ? returnUrl! : home);
  }
}
