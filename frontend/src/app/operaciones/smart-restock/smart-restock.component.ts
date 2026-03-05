import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { ProductoService } from '../../services/producto.service';
import { SmartRestockItem } from '../../producto/producto.interface';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { ChangeDetectorRef } from '@angular/core';

@Component({
  selector: 'app-smart-restock',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatProgressSpinnerModule, MatIconModule],
  templateUrl: './smart-restock.component.html',
})
export class SmartRestockComponent implements OnInit {
  displayedColumns: string[] = ['codigo', 'descripcion', 'vendidas', 'stock', 'precio', 'margen'];
  dataSource: SmartRestockItem[] = [];
  isLoading = true;

  constructor(private productoService: ProductoService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.productoService.getSmartRestock().subscribe({
      next: (res: any) => {
        this.dataSource = res.data || res;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err: unknown) => {
        console.error(err);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }
}
