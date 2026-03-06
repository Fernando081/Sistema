// backend/src/app.module.ts

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

// Módulos de Negocio
import { ClienteModule } from './cliente/cliente.module';
import { ProveedorModule } from './proveedor/proveedor.module';
import { ProductoModule } from './producto/producto.module';
import { CategoriaModule } from './categoria/categoria.module';

import { CompraModule } from './compra/compra.module';

// Módulo Padre de Catálogos (¡Solo importamos este!)
import { CatalogosModule } from './catalogos/catalogos.module';

import { parseSsl } from './db-ssl.util';
import { VentaModule } from './venta/venta.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CotizacionModule } from './cotizacion/cotizacion.module';
import { PagoModule } from './pago/pago.module';
import { PagoProveedorModule } from './pago-proveedor/pago-proveedor.module';
import { AuthModule } from './auth/auth.module';
import { ReportesModule } from './reportes/reportes.module';
import { FinanzasModule } from './finanzas/finanzas.module';
import { UploadModule } from './upload/upload.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'backend/.env'],
    }),
    ScheduleModule.forRoot(),
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
          };
        }

        return {
          type: 'postgres' as const,
          host: configService.get<string>('DB_HOST', '127.0.0.1'),
          port: parseInt(configService.get<string>('DB_PORT', '6543'), 10),
          username: configService.get<string>('DB_USER', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_NAME', 'postgres'),
          autoLoadEntities: true,
          synchronize: false,
          ssl: parseSsl(configService),
        };
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
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
    ReportesModule,
    FinanzasModule,
    UploadModule,
    AuditoriaModule,
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
