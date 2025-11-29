// backend/src/app.module.ts (REEMPLAZAR)

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

// Módulos de Negocio
import { ClienteModule } from './cliente/cliente.module';
import { ProveedorModule } from './proveedor/proveedor.module';
import { ProductoModule } from './producto/producto.module';
import { CategoriaModule } from './categoria/categoria.module';

import { CompraModule } from './compra/compra.module';

// Módulo Padre de Catálogos (¡Solo importamos este!)
import { CatalogosModule } from './catalogos/catalogos.module';

// Entidades (Aquí sí debemos listar todas para TypeORM)
import { Cliente } from './cliente/cliente.entity';
import { Proveedor } from './proveedor/proveedor.entity';
import { Producto } from './producto/producto.entity';
import { Categoria } from './categoria/categoria.entity';
import { RegimenFiscal } from './catalogos/entities/regimen-fiscal.entity';
import { FormaPago } from './catalogos/entities/forma-pago.entity';
import { MetodoPago } from './catalogos/entities/metodo-pago.entity';
import { UsoCFDI } from './catalogos/entities/uso-cfdi.entity';
import { Estado } from './catalogos/entities/estado.entity';
import { Municipio } from './catalogos/entities/municipio.entity';
import { ClaveProdServ } from './catalogos/entities/clave-prod-serv.entity';
import { ClaveUnidad } from './catalogos/entities/clave-unidad.entity';
import { Unidad } from './catalogos/entities/unidad.entity';
import { ObjetoImpuesto } from './catalogos/entities/objeto-impuesto.entity';
import { VentaModule } from './venta/venta.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CotizacionModule } from './cotizacion/cotizacion.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '6543'),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true, 
      synchronize: false, 
      ssl: { rejectUnauthorized: false },
      entities: [
        Cliente, Proveedor, Producto, Categoria,
        RegimenFiscal, FormaPago, MetodoPago, UsoCFDI, Estado, Municipio,
        ClaveProdServ, ClaveUnidad, Unidad, ObjetoImpuesto
      ],
    }),
    ClienteModule,
    ProveedorModule,
    ProductoModule,
    CategoriaModule,
    CatalogosModule, // ¡Mucho más limpio!
    VentaModule,
    CompraModule,
    DashboardModule,
    CotizacionModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}