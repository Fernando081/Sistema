// frontend/src/app/app.routes.ts

import { Routes } from '@angular/router';

export const routes: Routes = [
  // Redirigir la ruta vacía a 'clientes'
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'cliente',
    loadComponent: () => import('./cliente/cliente-list/cliente-list.component').then(m => m.ClienteListComponent)
  },
  // (Aquí irán las rutas de productos, facturas, etc.)
  {
    path: 'proveedor',
    loadComponent: () => import('./proveedor/proveedor-list/proveedor-list.component').then(m => m.ProveedorListComponent)
  },
  {
    path: 'producto',
    loadComponent: () => import('./producto/producto-list/producto-list.component').then(m => m.ProductoListComponent)
  },
  {
    path: 'venta',
    loadComponent: () => import('./venta/venta.component').then(m => m.VentaComponent)
  },
  {
    path: 'facturas',
    loadComponent: () => import('./venta/factura-list/factura-list.component').then(m => m.FacturaListComponent)
  },
  {
    path: 'compra',
    loadComponent: () => import('./compra/compra.component').then(m => m.CompraComponent)
  },
  {
  path: 'cotizacion/nueva',
  loadComponent: () => import('./cotizacion/nueva-cotizacion/nueva-cotizacion.component').then(m => m.NuevaCotizacionComponent)
  },
  {
  path: 'cotizacion/historial',
  loadComponent: () => import('./cotizacion/cotizacion-list/cotizacion-list.component').then(m => m.CotizacionListComponent)
  },
  {
  path: 'compra/historial',
  loadComponent: () => import('./compra/compra-list/compra-list.component').then(m => m.CompraListComponent)
  },
  {
    path: 'cobranza',
    loadComponent: () => import('./pago/cobranza/cobranza.component').then(m => m.CobranzaComponent)
  },
  {
    path: 'cuentas-por-pagar',
    loadComponent: () => import('./pago/cuentas-por-pagar/cuentas-por-pagar.component').then(m => m.CuentasPorPagarComponent)
  }
];