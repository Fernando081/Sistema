// backend/src/app.module.ts

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { Pago } from './pago/pago.entity';
import { PagoModule } from './pago/pago.module';
import { PagoProveedorModule } from './pago-proveedor/pago-proveedor.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AuthUser } from './auth/auth-user.entity';

const parseSsl = (configService: ConfigService): false | { rejectUnauthorized: boolean } => {
  const rawSsl = configService.get<string>('DB_SSL');
  if (!rawSsl) {
    return false;
  }

  const normalized = rawSsl.trim().toLowerCase();
  const truthyValues = new Set(['true', '1', 'yes', 'y', 'on']);

  return truthyValues.has(normalized) ? { rejectUnauthorized: false } : false;
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'backend/.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');

        if (databaseUrl) {
          return {
            type: 'postgres' as const,
            url: databaseUrl,
            autoLoadEntities: true,
            synchronize: false,
            ssl: parseSsl(configService),
            entities: [
              Cliente,
              Proveedor,
              Producto,
              Categoria,
              RegimenFiscal,
              FormaPago,
              MetodoPago,
              UsoCFDI,
              Estado,
              Municipio,
              ClaveProdServ,
              ClaveUnidad,
              Unidad,
              ObjetoImpuesto,
              Pago,
              AuthUser,
            ],
          };
        }

        return {
          type: 'postgres' as const,
          host: configService.get<string>('DB_HOST', '127.0.0.1'),
          port: parseInt(configService.get<string>('DB_PORT', '5432'), 10),
          username: configService.get<string>('DB_USER', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_NAME', 'postgres'),
          autoLoadEntities: true,
          synchronize: false,
          ssl: parseSsl(configService),
          entities: [
            Cliente,
            Proveedor,
            Producto,
            Categoria,
            RegimenFiscal,
            FormaPago,
            MetodoPago,
            UsoCFDI,
            Estado,
            Municipio,
            ClaveProdServ,
            ClaveUnidad,
            Unidad,
            ObjetoImpuesto,
            Pago,
            AuthUser,
          ],
        };
      },
    }),
    ClienteModule,
    ProveedorModule,
    ProductoModule,
    CategoriaModule,
    CatalogosModule,
    VentaModule,
    CompraModule,
    DashboardModule,
    CotizacionModule,
    PagoModule,
    PagoProveedorModule,
    AuthModule,
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
