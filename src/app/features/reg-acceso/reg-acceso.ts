import { Component, OnInit, inject, ChangeDetectorRef, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize, catchError, of } from 'rxjs';

import { RegAccesoDialogComponent } from './components/reg-acceso-dialog/reg-acceso-dialog';
import { RegAccesoService } from './services/reg-acceso.service';
import { Acceso } from './models/reg-acceso.model';
import { DataTableComponent } from '@shared/components/data-table/data-table';
import { ConfirmarSalidaDialogComponent } from './components/reg-confirmar-salida-dialog/confirmar-salida-dialog';
import { RegistroManualDialogComponent } from './components/registro-manual-dialog/registro-manual-dialog';


interface UltimoRegistro {
  tipo: string;
  usuario: string;
  hora: string;
}

@Component({
  selector: 'app-reg-acceso',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    DataTableComponent,
    
  ],
  templateUrl: './reg-acceso.html',
  styleUrls: ['./reg-acceso.scss']
})
export class RegAccesoComponent implements OnInit {
  @ViewChild('codigoInput') codigoInput!: ElementRef<HTMLInputElement>;
  @ViewChild('tabla') tabla?: DataTableComponent;

  // Guarda el valor de texto actual escrito por el usuario en el buscador
  filtroTexto: string = '';

  // Aplica el filtro sobre la tabla cuando el usuario digita en el buscador
  aplicarFiltro(event: Event): void {
    const valor = (event.target as HTMLInputElement).value;
    this.filtroTexto = valor;
    if (this.tabla) {
      this.tabla.onFilterChange(event); // Llama al método de filtrado de la tabla compartida
    }
  }

  // Limpia el buscador y restablece los registros originales de la tabla
  limpiarFiltro(): void {
    this.filtroTexto = '';
    if (this.tabla) {
      this.tabla.clearFilter(); // Restablece el filtro interno de la tabla
    }
  }

  accesosRecientes: any[] = [];
  codigoBarras: string = '';
  isLoading: boolean = false;
  isLoadingTable: boolean = false;
  tableError: string | null = null;
  mostrarTabla: boolean = false;
  registroExitoso: boolean = false;
  dialogAbierto: boolean = false;
  ultimoRegistro: UltimoRegistro | null = null;

  private mantenerFoco = true;
  private focoTimeout: any;

  tableColumns = [
    { key: 'usuarioNombre', label: 'Usuario', type: 'text' },
    { key: 'documento', label: 'Documento', type: 'text' },
    { key: 'horaFecha', label: 'Fecha', type: 'date' },
    { key: 'tipoAcceso', label: 'Tipo', type: 'text' },
    { key: 'observacion', label: 'Observación', type: 'text' }
  ];

  private cdr = inject(ChangeDetectorRef);

  constructor(
    private regAccesoService: RegAccesoService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.cargarHistorial();
    setTimeout(() => this.enfocarInput(), 500);
  }

  ngOnDestroy(): void {
    if (this.focoTimeout) clearTimeout(this.focoTimeout);
  }

  onInputFocus(): void { this.mantenerFoco = true; }

  onInputBlur(): void {
    this.focoTimeout = setTimeout(() => {
      const activeEl = document.activeElement;
      const isOtherInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl !== this.codigoInput?.nativeElement;

      if (this.mantenerFoco && !this.isLoading && !this.dialogAbierto && !isOtherInput) {
        this.enfocarInput();
      }
    }, 250);
  }

  onSearchFocus(): void {
    this.mantenerFoco = false;
  }

  onSearchBlur(): void {
    this.mantenerFoco = true;
    setTimeout(() => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      if (this.mantenerFoco && !isInput && !this.isLoading && !this.dialogAbierto) {
        this.enfocarInput();
      }
    }, 150);
  }

  private enfocarInput(): void {
    if (this.codigoInput?.nativeElement && !this.isLoading && !this.dialogAbierto) {
      this.codigoInput.nativeElement.focus();
      this.cdr.detectChanges();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    const isDialog = !!target.closest('mat-dialog-container');

    if (!isInput && !isDialog && !this.isLoading && !this.dialogAbierto) {
      if (event.key.length === 1 || event.key === 'Enter') {
        this.enfocarInput();
      }
    }
  }

  // ─── LÓGICA COMPARTIDA: detectar entrada/salida por documento ───
  private detectarYAbrirDialogo(documento: string): void {
    this.regAccesoService.buscarUsuarioPorDocumento(documento).subscribe({
      next: (usuario) => {
        if (!usuario || !usuario.id) {
          this.mostrarError(`Documento N° ${documento} no registrado.`);
          return;
        }

        this.regAccesoService.obtenerAccesos().subscribe({
          next: (accesos) => {
            this.isLoading = false;

            const accesosUsuario = (accesos || [])
              .filter((a: any) => {
                const idAcceso = a.usuarioId ?? a.usuario?.id;
                return Number(idAcceso) === Number(usuario.id);
              })
              .sort((a: any, b: any) => {
                const fechaA = new Date(a.horaFecha || 0).getTime();
                const fechaB = new Date(b.horaFecha || 0).getTime();
                return fechaB - fechaA;
              });

            const ultimoAcceso = accesosUsuario.length > 0 ? accesosUsuario[0] : null;
            const esSalida = ultimoAcceso !== null && !!ultimoAcceso.accion;

            if (esSalida) {
              this.abrirConfirmarSalida(usuario);
            } else {
              this.abrirDialogoConDocumento(documento);
            }
          },
          error: () => {
            this.isLoading = false;
            this.abrirDialogoConDocumento(documento);
          }
        });
      },
      error: (err) => {
        this.isLoading = false;
        if (err.status === 404) {
          this.mostrarError(`Documento N° ${documento} no encontrado.`);
        } else {
          this.mostrarError('Error de conexión con el servidor.');
        }
      }
    });
  }

  // ─── PROCESAMIENTO DEL CÓDIGO DE BARRAS ─────────
  procesarCodigoBarras(): void {
    const documento = this.codigoBarras.trim();
    if (!documento) {
      this.enfocarInput();
      return;
    }

    if (!/^\d+$/.test(documento)) {
      this.snackBar.open('El documento debe contener solo números.', 'Cerrar', { duration: 3000 });
      this.codigoBarras = '';
      this.enfocarInput();
      return;
    }

    this.isLoading = true;
    this.mantenerFoco = false;
    this.cdr.detectChanges();

    this.detectarYAbrirDialogo(documento);
  }

  // ─── BOTÓN REGISTRAR ACCESO MANUAL ──────────────

  abrirDialogo(): void {
  this.dialogAbierto = true;
  this.mantenerFoco = false;

  const dialogRef = this.dialog.open(RegistroManualDialogComponent, {
    width: '400px',
    disableClose: false
  });

  dialogRef.afterClosed().subscribe(result => {
    this.dialogAbierto = false;
    this.mantenerFoco = true;

    if (result && result.documento) {
      const documento = result.documento;

      if (!/^\d+$/.test(documento)) {
        this.snackBar.open('El documento debe contener solo números.', 'Cerrar', { duration: 3000 });
        this.enfocarInput();
        return;
      }

      this.isLoading = true;
      this.cdr.detectChanges();
      this.detectarYAbrirDialogo(documento);
    } else {
      this.enfocarInput();
    }
  });
}

  // ─── DIÁLOGO DE CONFIRMACIÓN SIMPLE PARA SALIDA ───
  private abrirConfirmarSalida(usuario: any): void {
    this.dialogAbierto = true;
    this.mantenerFoco = false;

    const nombre = usuario.name || usuario.nombre || '';
    const apellido = usuario.lastName || usuario.apellido || '';
    const nombreCompleto = `${nombre} ${apellido}`.trim() || 'Usuario';

    const dialogRef = this.dialog.open(ConfirmarSalidaDialogComponent, {
      width: '400px',
      disableClose: false,
      data: {
        usuarioId: usuario.id,
        usuarioNombre: nombreCompleto,
        documento: usuario.docNumber || usuario.documento || ''
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      this.dialogAbierto = false;
      this.mantenerFoco = true;

      if (result && result.id) {
        this.ultimoRegistro = {
          tipo: 'Salida',
          usuario: nombreCompleto,
          hora: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };

        this.registroExitoso = true;
        this.snackBar.open(` Salida registrada: ${nombreCompleto}`, 'Cerrar', { duration: 3000 });
        this.cargarHistorial();

        setTimeout(() => {
          this.registroExitoso = false;
          this.cdr.detectChanges();
        }, 2000);
      }

      this.codigoBarras = '';
      setTimeout(() => this.enfocarInput(), 300);
    });
  }

  // ─── DIÁLOGO COMPLETO PARA ENTRADA ──────────────
  private abrirDialogoConDocumento(documentoEscaneado: string | null): void {
    this.dialogAbierto = true;
    this.mantenerFoco = false;

    const dialogRef = this.dialog.open(RegAccesoDialogComponent, {
      width: '500px',
      data: { documento: documentoEscaneado }
    });

    dialogRef.afterClosed().subscribe(result => {
      this.dialogAbierto = false;
      this.mantenerFoco = true;
      this.isLoading = false;

      if (result) {
        const tipo = result.accion ? 'Entrada' : 'Salida';
        const nombre = result.usuario?.name || result.usuario?.nombre || '';
        const apellido = result.usuario?.lastName || result.usuario?.apellido || '';
        const usuarioName = `${nombre} ${apellido}`.trim() || 'Usuario';

        this.ultimoRegistro = {
          tipo,
          usuario: usuarioName,
          hora: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };

        this.registroExitoso = true;
        this.snackBar.open(` ${tipo} registrada: ${usuarioName}`, 'Cerrar', { duration: 3000 });
        this.cargarHistorial();

        setTimeout(() => {
          this.registroExitoso = false;
          this.cdr.detectChanges();
        }, 2000);
      }

      this.codigoBarras = '';
      setTimeout(() => this.enfocarInput(), 300);
    });
  }

  // ─── CARGAR HISTORIAL ───────────────────────────
  cargarHistorial(): void {
    this.isLoadingTable = true;
    this.mostrarTabla = false;
    this.tableError = null;

    this.regAccesoService.obtenerAccesos().pipe(
      finalize(() => {
        this.isLoadingTable = false;
        this.mostrarTabla = true;
        this.cdr.detectChanges();
      }),
      catchError((err: any) => {
        console.error('[RegAcceso] Error:', err);
        this.tableError = 'Error al cargar los registros.';
        this.snackBar.open('Error al cargar el historial', 'Cerrar', { duration: 4000 });
        return of([]);
      })
    ).subscribe({
      next: (data) => {
        if (!Array.isArray(data)) {
          this.accesosRecientes = [];
          return;
        }

        this.accesosRecientes = data.map(acceso => ({
          ...acceso,
          usuarioNombre: acceso.usuario
            ? `${acceso.usuario.name} ${acceso.usuario.lastName}`
            : `Usuario ${acceso.usuarioId}`,
          documento: acceso.usuario?.docNumber || '-',
          tipoAcceso: this.getTipoAccesoLabel(acceso.accion),
          horaFecha: acceso.horaFecha
        }));
      }
    });
  }

  private mostrarError(mensaje: string): void {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 4000, panelClass: 'snackbar-error' });
    this.codigoBarras = '';
    this.isLoading = false;
    this.mantenerFoco = true;
    this.enfocarInput();
    this.cdr.detectChanges();
  }

  getTipoAccesoLabel(accion: boolean): string {
    return accion ? 'Entrada' : 'Salida';
  }
}