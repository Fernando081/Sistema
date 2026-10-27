import { Component, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { AccessProfile, AuthService, PermissionCatalogEntry } from '../auth.service';
import { ConfirmService } from '../../shared/confirm.service';

@Component({
  selector: 'app-access-profiles', standalone: true,
  imports: [ReactiveFormsModule,MatButtonModule,MatFormFieldModule,MatInputModule],
  templateUrl: './access-profiles.component.html',
  styleUrl: './access-profiles.component.css',
})
export class AccessProfilesComponent {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly confirm = inject(ConfirmService);
  private readonly snack = inject(MatSnackBar);
  readonly profiles = input<AccessProfile[]>([]);
  readonly catalog = input<PermissionCatalogEntry[]>([]);
  readonly changed = output<void>();
  readonly busy = signal(false);
  readonly editorOpen = signal(false);
  readonly editing = signal<AccessProfile|null>(null);
  readonly codes = signal<string[]>([]);
  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required,Validators.maxLength(80),Validators.pattern(/\S/)]],
    description: ['',Validators.maxLength(500)],
  });

  edit(profile: AccessProfile|null, duplicate = false) {
    if (this.busy()) return;
    this.editing.set(duplicate ? null : profile);
    this.form.reset({name: duplicate ? `${profile?.name ?? ''} (copia)`.slice(0,80) : profile?.name ?? '',description:profile?.description ?? ''});
    this.codes.set([...(profile?.permissions ?? [])]);this.editorOpen.set(true);
  }

  toggle(code: string,event: Event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.codes.update(values => event.target instanceof HTMLInputElement && event.target.checked ? [...values,code] : values.filter(value=>value!==code));
  }

  save() {
    if (this.busy() || this.form.invalid) return;
    const profile = this.editing();
    if (profile && profile.assignedUsers) {
      this.confirm.ask({title:'Actualizar perfil',message:`Cambiará el acceso de ${profile.assignedUsers} usuario(s) y se cerrarán sus sesiones. Las excepciones individuales se conservan.`,confirmLabel:'Actualizar perfil',tone:'primary'})
        .subscribe(confirmed=>{if(confirmed)this.persist();});
    } else this.persist();
  }

  private persist() {
    if (this.busy()) return;
    const profile=this.editing(),body={...this.form.getRawValue(),permissions:this.codes()};
    this.busy.set(true);
    (profile ? this.auth.updateAccessProfile(profile.idProfile,{...body,version:profile.version}) : this.auth.createAccessProfile(body))
      .pipe(finalize(()=>this.busy.set(false))).subscribe({next:()=>{
        this.editorOpen.set(false);this.changed.emit();this.snack.open('Perfil guardado.','Cerrar');
      },error:()=>{this.changed.emit();}});
  }

  remove(profile: AccessProfile) {
    if (this.busy() || profile.assignedUsers) return;
    this.confirm.ask({title:'Eliminar perfil',message:`Se eliminará el perfil «${profile.name}».`,confirmLabel:'Eliminar',tone:'danger'}).subscribe(confirmed=>{
      if(!confirmed)return;this.busy.set(true);
      this.auth.deleteAccessProfile(profile.idProfile,profile.version).pipe(finalize(()=>this.busy.set(false)))
        .subscribe({next:()=>{this.editorOpen.set(false);this.changed.emit();this.snack.open('Perfil eliminado.','Cerrar');},error:()=>this.changed.emit()});
    });
  }
}
